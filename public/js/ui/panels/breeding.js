// The Breeding Barn (GDD §3.4 "Breeding Barn (L28)", M2; w3 ui-home lane): pick two adults of one species; after twice
// the species' baby time a baby is ready with a coat (white 40 % / brown 30 % / spotted 25 % / golden 5 %, and a golden
// coat for certain by the 20th breeding of a species without one). The couple names it and brings it home; its parents
// are untouched and a coat changes nothing but the look. One breeding at a time (the barn has one pen). The panel shows
// the pairing, the coat odds with the golden countdown, the cost and the time, the baby on the way (and its reveal), and
// which coats each species already wears on the farm.
//
//   breedingView(state, pid, now, sel?) -> plain data (tested in node)   breedingPanel: the 'breeding' panel ({ species? })
//
// Rules (rules-economy, shared/rules/actions/breeding.js): breed {a, b}, breedCancel {}, breedCollect {name?, home?};
// breedingOpen / breedingOf / breedCost / breedMs; state farm.breed = { cur, n: { sp }, pity: { sp } }; events
// breedStarted, breedCancelled, bred { id, species, coat, golden, name? }.
import { BREEDING, animalOf, itemOf, isLive } from '../../../../shared/content/index.js';
import * as breedA from '../../../../shared/rules/actions/breeding.js';
import * as animalsA from '../../../../shared/rules/actions/animals.js';
import { sortedKeys } from '../../../../shared/rules/order.js';
import { levelOf, available } from './core.js';
import { h, fmt, fmtDuration, createKit, icon, svgIcon, fill, chip, bar, counted } from './kit.js';
import { careGlyph, coatSwatch } from './home-art.js';
import { animalSwitch, babyNoun, animalName, nameEditor, nameOf } from './nursery.js';
import { t, has, lang, N, ctext, fmtDec, ordinal, name as cname } from '../../i18n/index.js';

const COAT_NAMES = { white: 'White', brown: 'Brown', spotted: 'Spotted', golden: 'Golden' };
const coatEnglish = (id) => COAT_NAMES[id] ?? BREEDING.seasonCoats?.find((c) => c.id === id)?.id?.replace(/^./, (c) => c.toUpperCase()) ?? id;
/** A coat's name ("Spotted"; Bulgarian "Петниста", agreeing with "окраска"): lane B's coats texts, else this catalog. */
export const coatName = (id) => {
  if (lang() === 'en') return coatEnglish(id);
  const s = ctext('coats', id, 'name', has(`home.breed.coat.${id}`) ? t(`home.breed.coat.${id}`) : coatEnglish(id));
  return s ? s[0].toLocaleUpperCase('bg') + s.slice(1) : s;
};
/** The baby noun with its article ("теленцето"), for Bulgarian lines about one baby. */
const nounDef = (sp) => t(`home.nursery.nounDef.${['chicken', 'cow', 'sheep', 'pig', 'duck', 'goat', 'horse', 'alpaca'].includes(sp) ? sp : 'other'}`);
/** "the 5th calf" (English) / "5-то теленце" (a baby noun is neuter in Bulgarian). */
// a no-break hyphen keeps "20-то" on one line
const ord = (n) => (lang() === 'en' ? ordEn(n) : ordinal(n, 'n').replace('-', '\u2011'));
const adultNoun = (def) => (lang() === 'en' ? def.name.toLowerCase() : cname(def.id, { form: 'lc' }));

const isColony = (o) => (typeof animalsA.isColony === 'function' ? animalsA.isColony(o) : false);

export function breedingIsOpen(state) {
  if (typeof breedA.breedingOpen === 'function') return breedA.breedingOpen(state);
  return isLive(BREEDING) && levelOf(state) >= BREEDING.unlock;
}

function costOf(sp) {
  if (typeof breedA.breedCost === 'function') return breedA.breedCost(sp);
  const def = animalOf(sp);
  return { item: def.bottle, qty: def.bottle === 'baby_bottle' ? BREEDING.cost.bottles : BREEDING.cost.poultryFeed };
}

function msOf(state, sp, now) {
  if (typeof breedA.breedMs === 'function') return breedA.breedMs(state, sp, now);
  return animalOf(sp).babyMs * BREEDING.timeMul;
}

/** The breedings left until a golden coat is certain for `sp` (1 = the next one), from the pity counter. */
export function goldenIn(state, sp) {
  const since = state.farm.breed?.pity?.[sp] ?? 0;
  return Math.max(1, BREEDING.goldenPity - since);
}

/**
 * Everything the Breeding Barn draws. Pure. `sel` = { species, a, b } (the player's picks; defaults: the first species
 * with two adults and its first two adults).
 */
export function breedingView(state, pid, now, sel = {}) {
  const open = breedingIsOpen(state);
  const bySp = new Map();
  for (const id of sortedKeys(state.farm.objects)) {
    const o = state.farm.objects[id];
    const def = animalOf(o.def);
    if (!def || o.home === undefined || isColony(o)) continue;
    if (!bySp.has(o.def)) bySp.set(o.def, []);
    const adult = now >= (o.adultAt ?? 0);
    bySp.get(o.def).push({ id, species: o.def, noun: adult ? adultNoun(def) : babyNoun(o.def), name: nameOf(state, id),
      coat: o.coat ?? null, adult, home: o.home });
  }
  const species = (BREEDING.species ?? []).filter((sp) => animalOf(sp) && isLive(animalOf(sp))).map((sp) => {
    const def = animalOf(sp);
    const all = bySp.get(sp) ?? [];
    const adults = all.filter((x) => x.adult);
    const cost = costOf(sp);
    const room = typeof animalsA.homesWithRoom === 'function' ? animalsA.homesWithRoom(state, def).length : 1;
    const coats = new Set(all.map((x) => x.coat).filter(Boolean));
    return { id: sp, name: cname(sp), noun: babyNoun(sp), owned: all.length, adults, canPair: adults.length >= 2, room,
      cost, have: available(state, cost.item), costName: itemOf(cost.item) ? cname(cost.item) : cost.item, ms: msOf(state, sp, now),
      bred: state.farm.breed?.n?.[sp] ?? 0, goldenIn: goldenIn(state, sp), coats: BREEDING.coats.map((c) => ({ id: c.id, found: coats.has(c.id) })),
      seasonCoats: [...coats].filter((c) => !BREEDING.coats.some((x) => x.id === c)) };
  });
  // the default pair: a species that can breed right now (two adults, room for the baby, the bottles in the barn)
  const ready = (x) => x.canPair && x.room > 0 && x.have >= x.cost.qty;
  const pairable = [...species.filter(ready), ...species.filter((x) => x.canPair && !ready(x))];
  const sp = species.find((x) => x.id === sel.species) ?? pairable[0] ?? species.find((x) => x.owned > 0) ?? null;
  let a = sel.a ?? null;
  let b = sel.b ?? null;
  if (sp) {
    const ids = new Set(sp.adults.map((x) => x.id));
    if (!ids.has(a)) a = null;
    if (!ids.has(b) || b === a) b = null;
    if (sel.a === undefined && sel.b === undefined) { a = sp.adults[0]?.id ?? null; b = sp.adults[1]?.id ?? null; }
  } else { a = null; b = null; }
  const raw = typeof breedA.breedingOf === 'function' ? breedA.breedingOf(state) : state.farm.breed?.cur ?? null;
  let cur = null;
  if (raw) {
    const parent = (id) => {
      const o = state.farm.objects[id];
      const noun = animalOf(raw.sp) ? adultNoun(animalOf(raw.sp)) : t('home.breed.animal');
      return o ? { id, name: nameOf(state, id), noun, coat: o.coat ?? null } : { id, name: null, noun, gone: true };
    };
    cur = { species: raw.sp, name: animalOf(raw.sp) ? cname(raw.sp) : raw.sp, noun: babyNoun(raw.sp), at: raw.at, readyAt: raw.readyAt,
      ready: now >= raw.readyAt, pct: Math.max(0, Math.min(1, (now - raw.at) / Math.max(1, raw.readyAt - raw.at))), by: raw.by,
      parents: [parent(raw.a), parent(raw.b)], cost: raw.cost, goldenIn: goldenIn(state, raw.sp) };
  }
  const odds = BREEDING.coats.map((c) => ({ id: c.id, bp: c.bp }));
  return { open, live: isLive(BREEDING), unlock: BREEDING.unlock, level: levelOf(state), species, sp, a, b, cur, odds,
    pity: BREEDING.goldenPity, timeMul: BREEDING.timeMul };
}

/** The Breeding Barn's dock badge: '!' when a baby is ready to come home. */
export function breedingBadge(state, pid, now) {
  const v = breedingView(state, pid, now);
  return v.open && v.cur && v.cur.ready ? '!' : null;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

function ordEn(n) {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
}

function goldenLine(n, noun) {
  return n <= 1 ? t('home.breed.sureGolden', { noun }) : t('home.breed.goldenBy', { ord: ord(n), noun });
}

function oddsBox(v, sp) {
  return h('div.br-odds', { role: 'list', 'aria-label': t('home.breed.oddsAria') },
    ...v.odds.map((c) => h('div.br-odd', { role: 'listitem' }, coatSwatch(c.id, { size: 34 }),
      h('span', h('b', coatName(c.id)), h('small', `${fmtDec(c.bp / 100, 2)}${lang() === 'bg' ? '\u00a0' : ' '}%`)),
      bar(c.bp / 4000, null, `pn-thin br-odd-bar br-odd-${c.id}`))),
    sp ? h('p.br-golden', svgIcon('star', 18), goldenLine(sp.goldenIn, sp.noun)) : null);
}

function parentCard(a, { picked = false, slot = null, onClick }) {
  return h(`button.br-adult${picked ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(picked), dataset: { key: `adult-${a.id}`, adult: a.id },
    on: { click: onClick } },
  icon(a.species, { size: 44, alt: '' }), a.coat ? coatSwatch(a.coat, { size: 20, label: t('home.breed.coatLabel', { coat: coatName(a.coat) }) }) : null,
  h('span', h('b', animalName(a)), slot ? h('small', slot) : null));
}

function penCard(ctx, kit, v) {
  const c = v.cur;
  const st = ctx.store.state;
  const parents = h('div.br-parents', ...c.parents.map((p) => h('div.br-parent', icon(c.species, { size: 52, alt: '' }),
    h('b', p.gone ? t('home.breed.gone') : animalName(p)))), h('span.br-heart', careGlyph('heart', 30)));
  const baby = h('div.br-baby', h('div.br-baby-ring', { style: { '--p': String(c.pct) } }, icon(c.species, { size: 54, alt: '' }),
    c.ready ? null : h('span.br-baby-q', '?')));
  let act;
  if (c.ready) {
    let name = '';
    const input = h('input.br-name-input', { type: 'text', maxLength: 16, placeholder: t('home.nursery.namePh', { noun: c.noun }), 'aria-label': t('home.breed.nameNew', { noun: c.noun }),
      on: { input: (e) => { name = e.target.value; }, keydown: (e) => e.stopPropagation() } });
    act = h('div.br-collect', h('p', t('home.breed.isHere', { noun: c.noun, def: nounDef(c.species) })),
      input, kit.button({ label: t('home.breed.bringHome'), glyph: 'heart', cls: 'btn--sun', type: 'breedCollect',
        args: () => (name.trim() ? { name: name.trim() } : {}), data: { collect: c.species },
        hint: { texts: { CAP: t('home.breed.homeFull', { name: c.name, sp: N(c.species) }) } } }));
  } else {
    act = h('div.br-wait',
      kit.timer(h('b.br-wait-t'), { end: c.readyAt, start: c.at, prefix: t('home.breed.readyIn'), doneText: t('market.kit.ready'), done: () => ctx.refreshBreeding?.() }),
      h('small', t('home.breed.startedBy', { who: c.by === ctx.store.pid ? t('home.fish.you') : st.players[c.by]?.name ?? t('home.breed.partner') })),
      kit.confirmButton({ label: t('home.breed.stop', { what: counted(c.cost?.qty ?? 2, c.cost?.item ?? 'baby_bottle') }), cls: 'pn-xs pn-ghost',
        confirm: t('home.breed.stopSure'), type: 'breedCancel', args: {}, data: { cancel: 'breeding' } }));
  }
  return h('section.br-pen', { dataset: { pen: c.species } },
    h('h3', t('home.breed.onWay', { noun: c.noun })), h('div.br-pen-row', parents, svgIcon('star', 22), baby), act,
    h('p.br-golden', svgIcon('star', 18), goldenLine(c.goldenIn, c.noun)));
}

function pairCard(ctx, kit, v, sel, setSel) {
  const sp = v.sp;
  if (!sp) {
    return h('div.br-empty', careGlyph('heart', 56), h('p', t('home.breed.empty')),
      h('button.btn.btn--sky.pn-sm', { type: 'button', on: { click: () => ctx.open('market', { tab: 'animals' }) } }, t('home.breed.marketAnimals')));
  }
  const pickSp = h('div.br-species', { role: 'radiogroup', 'aria-label': t('home.breed.which') },
    ...v.species.filter((x) => x.owned > 0).map((x) => h(`button.br-sp${x.id === sp.id ? '.on' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(x.id === sp.id), dataset: { key: `sp-${x.id}`, species: x.id },
      title: x.canPair ? t('home.breed.grown', { n: x.adults.length, what: x.name.toLowerCase(), sp: N(x.id) }) : t('home.breed.needsTwo', { what: x.name.toLowerCase(), sp: N(x.id) }),
      on: { click: () => setSel({ species: x.id }) } }, icon(x.id, { size: 40, alt: '' }), h('b', x.name),
    h('small', x.canPair ? t('home.breed.adults', { n: x.adults.length }) : t('home.breed.adultsFew', { n: x.adults.length })))));
  const slotOf = (id) => (id === v.a ? t('home.breed.parent1') : id === v.b ? t('home.breed.parent2') : null);
  const toggle = (id) => {
    if (id === v.a) setSel({ species: sp.id, a: v.b, b: null });
    else if (id === v.b) setSel({ species: sp.id, a: v.a, b: null });
    else if (!v.a) setSel({ species: sp.id, a: id, b: v.b });
    else setSel({ species: sp.id, a: v.a, b: id });
  };
  const adults = h('div.br-adults', ...sp.adults.map((a) => parentCard(a, { picked: Boolean(slotOf(a.id)), slot: slotOf(a.id), onClick: () => toggle(a.id) })));
  const facts = h('ul.br-facts',
    h('li', svgIcon('star', 20), h('span', t('home.breed.takes', { d: fmtDuration(sp.ms), noun: sp.noun, def: nounDef(sp.id) }))),
    h('li', icon(sp.cost.item, { size: 22, alt: '' }), h('span', t('home.breed.costs', { what: counted(sp.cost.qty, sp.cost.item) })), chip(sp.cost.item, { have: sp.have, need: sp.cost.qty, size: 26 })),
    h('li', svgIcon('heart', 20), h('span', sp.room > 0 ? t('home.breed.room') : t('home.breed.noRoom'))));
  const btn = kit.button({ label: v.a && v.b ? t('home.breed.pair') : t('home.breed.pickTwo'), glyph: 'heart', cls: 'btn--sun', type: 'breed',
    args: () => ({ a: v.a ?? '', b: v.b ?? '' }), data: { breed: sp.id },
    gate: () => (!v.a || !v.b ? { code: 'NOT_READY', hint: { text: t('home.breed.pickTwoTip') } } : null),
    hint: { missing: [{ item: sp.cost.item, n: sp.cost.qty }], texts: { CAP: t('home.breed.capText'),
      OCCUPIED: t('home.breed.busy') } } });
  // the client's matchmaker (game/pairing.js): pick the two on the farm itself, with their homes aglow
  const pairing = ctx.controller && ctx.controller.pairing && typeof ctx.controller.pairing.start === 'function' ? ctx.controller.pairing : null;
  const onFarm = pairing && sp.canPair ? h('button.pn-chipbtn.br-onfarm', { type: 'button', dataset: { key: 'pair-farm' },
    title: t('home.breed.onFarmTip'),
    on: { click: () => { let ok = false; try { ok = pairing.start(undefined, sp.id) !== false; } catch (err) { console.error('pairing failed', err); } if (ok) ctx.close(); } } },
  t('home.breed.onFarm')) : null;
  return h('section.br-pair',
    h('div.br-pair-head', h('h3', t('home.breed.pickPair')), onFarm), pickSp,
    sp.canPair ? adults : h('p.hm-note', t('home.breed.twoNeeded', { what: sp.name.toLowerCase(), sp: N(sp.id) })),
    h('div.br-pair-foot', oddsBox(v, sp), h('div.br-pair-side', facts, btn)));
}

function coatsBook(v) {
  const rows = v.species.filter((x) => x.owned > 0);
  if (!rows.length) return null;
  return h('section.br-coats', h('h3.pn-h', h('span', t('home.breed.coats'))),
    h('ul', ...rows.map((x) => h('li.br-coat-row', icon(x.id, { size: 36, alt: '' }), h('b', x.name),
      h('span.br-coat-swatches', ...x.coats.map((c) => coatSwatch(c.id, { size: 30, found: c.found, label: c.found ? coatName(c.id) : t('home.breed.notYet', { coat: coatName(c.id) }) })),
        ...x.seasonCoats.map((c) => coatSwatch(c, { size: 30, hue: BREEDING.seasonCoats?.find((s2) => s2.id === c)?.hue, label: t('home.breed.season', { coat: coatName(c) }) }))),
      h('small', x.bred ? t('home.breed.bred', { n: x.bred }) : t('home.breed.noneBred'))))));
}

export const breedingPanel = {
  title: () => t('home.nursery.breeding'),
  icon: 'barn',
  size: 'wide',
  topics: ['objects', 'inventory', 'overflow', 'xp', 'breed', 'players'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let sel = ctx.args?.species ? { species: ctx.args.species } : {};
    let reveal = null;
    const setSel = (x) => { sel = x; update(true); };
    const sig = () => {
      const v = breedingView(ctx.store.state, ctx.store.pid, ctx.now(), sel);
      return [v.open, v.sp?.id, v.a, v.b, v.cur && [v.cur.species, v.cur.ready, v.cur.parents.map((p) => p.name)],
        v.species.map((x) => [x.id, x.adults.length, x.have, x.room, x.bred, x.coats.map((c) => c.found)]), reveal];
    };
    const update = kit.memo(body, sig, render);
    ctx.refreshBreeding = () => update(true);
    ctx.every(5_000, () => update());
    // the coat shows the moment the baby arrives (a confirmed or predicted `bred`), on both screens
    ctx.on(ctx.store, 'fx', ({ ev }) => {
      if (!ev || ev.e !== 'bred') return;
      reveal = { id: ev.id, species: ev.species, coat: ev.coat, golden: ev.golden, name: ev.name ?? null, by: ev.by };
      update(true);
    });
    function render() {
      const st = ctx.store.state;
      const v = breedingView(st, ctx.store.pid, ctx.now(), sel);
      if (!v.open) {
        fill(body, animalSwitch(ctx, 'breeding'), h('div.br-locked', careGlyph('heart', 64),
          h('p', v.live ? t('home.breed.opensAt', { n: v.unlock }) : t('home.breed.nextChapter'))));
        return;
      }
      const shown = reveal && st.farm.objects[reveal.id] ? reveal : null;
      const rv = shown ? h('section.br-reveal', { dataset: { reveal: shown.coat } },
        coatSwatch(shown.coat, { size: 64, label: t('home.breed.coatLabel', { coat: coatName(shown.coat) }) }),
        h('div', h('h3', shown.golden ? t('home.breed.golden', { noun: babyNoun(shown.species) })
          : has(`home.breed.coatN.${shown.coat}`) ? t('home.breed.coated', { coat: coatName(shown.coat).toLowerCase(), adj: t(`home.breed.coatN.${shown.coat}`), noun: babyNoun(shown.species) })
            : t('home.breed.coatedOther', { coat: coatName(shown.coat), noun: babyNoun(shown.species) })),
          h('p', t('home.breed.home', { name: shown.name ?? t('home.breed.theBaby'),
            who: shown.by === ctx.store.pid ? t('home.breed.withYou') : st.players[shown.by]?.name ?? t('home.breed.partner') })),
          h('div.br-reveal-acts', nameEditor(ctx, { id: shown.id, name: st.farm.objects[shown.id]?.name ?? null, noun: babyNoun(shown.species) }),
            h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('nursery', { id: shown.id }) } }, t('home.breed.card')),
            h('button.pn-chipbtn', { type: 'button', on: { click: () => { reveal = null; update(true); } } }, t('common.close'))))) : null;
      fill(body, animalSwitch(ctx, 'breeding'),
        rv,
        v.cur ? penCard(ctx, kit, v) : pairCard(ctx, kit, v, sel, setSel),
        coatsBook(v));
      kit.refresh();
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};

