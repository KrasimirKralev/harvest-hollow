// The M1b animals (GDD §3.4, ui-collect lane): a section under each new home's animal grid (pigs and their truffle
// hunt, the duck pond, the goat, the horse and the beehive), the giant-crop banners (§6.2 #8) and the new-unlock
// banners of the lane's systems.
//
//   homeExtras(state, homeId, now) -> plain data | null        (tested in node)
//   m1bSection(v, ctx, kit) -> Element | null                   v = model.homeView(); the animals panel appends it
//   forageNear(state, hiveId) -> { n, need, radius, cycleMs, fast, sources: [{ id, def, n }] }
//   giantBanners(ui, store, view) / unlockBanners(ui, store) -> stop
//   featureTarget(featureId) -> { panel, args } | null           "Show me" for a system unlock (levelup.js can use it)
import {
  animalOf, homeOf, itemOf, defOf, cropOf, feedOf, expansionOf, isLive, featureOf, collectionOf, usesOf, recipeOf,
  pluralOf, CONTENT,
  GROWTH, BARGE, COOP, COLLECTION_RULES, FARM_BEAUTY, levelFromXp,
} from '../../../../shared/content/index.js';
import * as animalsA from '../../../../shared/rules/actions/animals.js';
import { idsAround } from '../../../../shared/rules/grid.js';
import { collectionPerk } from '../../../../shared/rules/economy.js';
import * as restoreA from '../../../../shared/rules/actions/restoration.js';
import { levelOf } from './model.js';
import { h, fmt, fmtDuration, icon, svgIcon, pill, bar, hintable } from './kit.js';
import { setState } from './collections.js';

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const have = (state, item) => (own(state.farm.inventory, item) ?? 0) + (own(state.farm.overflow, item) ?? 0);

// ---- bees: forage around a hive -----------------------------------------------------------------------------------

/**
 * A hive's forage (GDD §3.4 Bees): the rules' count (forageNear: flower crops, flowering trees, flower decor, the
 * Hollow Meadow) and, for the panel, which objects around it count (forageOfObject over the same radius).
 */
export function forageNear(state, hiveId) {
  const B = GROWTH.bees;
  const o = own(state.farm.objects, hiveId);
  const def = o && defOf(o.def);
  const radius = B.radius + collectionPerk(state, 'forageRadius');
  const bee = animalOf('bee');
  if (!o || !def || !Number.isSafeInteger(o.x)) return { n: 0, need: B.forageNeeded, radius, cycleMs: B.slowCycleMs,
    fast: false, sources: [] };
  const n = animalsA.forageNear(state, hiveId);
  const [w, d] = def.size ?? [1, 1];
  const sources = [];
  for (const id of idsAround(state, o.x, o.z, w, d, radius)) {
    if (id === hiveId) continue;
    const v = animalsA.forageOfObject(state.farm.objects[id]);
    if (v > 0) sources.push({ id, def: state.farm.objects[id].crop?.def ?? state.farm.objects[id].def, n: v });
  }
  const fast = n >= B.forageNeeded;
  return { n, need: B.forageNeeded, radius, cycleMs: bee ? animalsA.colonyCycleMs(state, hiveId, bee) : B.slowCycleMs,
    fast, sources };
}

/** Adult horses on the farm and the barge bonus they give (the rules' horseBargeBp: +5 % each, at most +20 %). */
export function horseBonus(state, now) {
  const adults = Object.values(state.farm.objects).filter((o) => o.def === 'horse' && o.home !== undefined && o.adultAt <= now).length;
  return { adults, pct: animalsA.horseBargeBp(state, now) / 100, each: BARGE.horseBp / 100,
    max: BARGE.horseMaxBp / 100 };
}

/** What a new home's section shows: species facts, goods, collection ties. Pure; null for an M1a home. */
export function homeExtras(state, homeId, now) {
  const o = own(state.farm.objects, homeId);
  const home = o && homeOf(o.def);
  if (!home) return null;
  const sp = animalOf(home.species?.[0]);
  if (!sp) return null;
  const level = levelOf(state);
  const product = itemOf(sp.product);
  const premium = itemOf(sp.premium);
  const uses = usesOf(sp.product).map((id) => recipeOf(id)).filter((r) => r && isLive(r)).slice(0, 4)
    .map((r) => ({ id: r.id, name: r.name, unlock: r.unlock ?? 1, building: r.building }));
  const base = { kind: sp.id, species: sp, product: sp.product, productName: product?.name ?? sp.product, out: sp.out,
    premium: sp.premium, premiumName: premium?.name ?? sp.premium, premiumPct: (sp.premiumBp ?? 0) / 100,
      cycleMs: sp.cycleMs,
    inBarn: have(state, sp.product), uses, level };
  switch (sp.id) {
    case 'pig': {
      const fos = setState(state, 'fossils');
      const woods = state.farm.expansions.includes('pig_woods');
      const slop = feedOf(sp.feed);
      return { ...base, feed: sp.feed, feedName: itemOf(sp.feed)?.name ?? 'Pig Slop', feedHave: have(state, sp.feed),
        slopIn: slop?.classes?.[0]?.qty ?? 2, slopOut: slop?.out ?? 6,
        woods, woodsPct: (expansionOf('pig_woods')?.feature?.truffleSpeedBp ?? 0) / 100,
        fossils: Object.keys(fos.items).length, fossilsOf: collectionOf('fossils')?.items.length ?? 5,
        fossilsLive: isLive(collectionOf('fossils')) && level >= COLLECTION_RULES.unlock };
    }
    case 'duck': {
      const fe = setState(state, 'feathers');
      return { ...base, feathers: Object.keys(fe.items).length, feathersOf: collectionOf('feathers')?.items.length ?? 5,
        feathersLive: isLive(collectionOf('feathers')) && level >= COLLECTION_RULES.unlock };
    }
    case 'goat': return { ...base };
    case 'horse': return { ...base, barge: horseBonus(state, now), compostPer: 3 };
    case 'bee': {
      const hives = Object.keys(state.farm.objects).filter((id) => state.farm.objects[id].def === 'beehive').length;
      const c = home.count ?? { base: 2, from: 13, every: 3, max: 8 };
      const cap = Math.min(c.max, c.base + (c.every > 0 ? Math.floor(Math.max(0, level - c.from) / c.every) : 0));
      const nextAt = cap < c.max && c.every > 0 ? c.from + (cap - c.base + 1) * c.every : null;
      const jars = setState(state, 'honey_jars');
      return { ...base, forage: forageNear(state, homeId), hives, hiveCap: cap, hiveNextAt: nextAt,
        pollinationPct: (GROWTH.bees.pollinationBp ?? 0) / 100, jars: Object.keys(jars.items).length,
        jarsOf: collectionOf('honey_jars')?.items.length ?? 5,
          jarsLive: isLive(collectionOf('honey_jars')) && level >= COLLECTION_RULES.unlock };
    }
    default: return null;
  }
}

// ---- the section --------------------------------------------------------------------------------------------------

const fact = (glyphOrIcon, title, text, cls = '') => h(`li.pc-fact${cls ? `.${cls}` : ''}`,
  typeof glyphOrIcon === 'string' && glyphOrIcon.startsWith('#') ? svgIcon(glyphOrIcon.slice(1),
    26) : icon(glyphOrIcon, { size: 34, alt: '' }),
  h('div', h('b', title), h('small', text)));

function albumLink(ctx, set, n, of) {
  if (!ctx.ui.panels.has('collections')) return null;
  return h('button.pn-chipbtn.pc-albumlink', { type: 'button', on: { click: () => ctx.open('collections', { set }) } },
    `${collectionOf(set)?.name ?? 'Album'} ${n}/${of}`);
}

/** The occupants of a home as the section needs them (when called without the panel's homeView). */
function homeAnimals(state, homeId, now) {
  return Object.keys(state.farm.objects).sort().filter((k) => state.farm.objects[k].home === homeId).map((k) => {
    const o = state.farm.objects[k];
    const status = o.readyAt === null || o.readyAt === undefined ? 'hungry' : o.readyAt <= now ? 'ready' : 'producing';
    return { id: k, status, start: o.fedAt ?? null, end: o.readyAt ?? null };
  });
}

const RIDE_TEXT = { NOT_READY: 'Too young to ride yet', OCCUPIED: 'Every horse has a rider',
  LOCKED: 'No grown horse yet', NOT_FOUND: 'No horse here' };

/**
 * Ride / Get off (client lane: controller.ride(horseId) walks to the Stable and mounts, controller.dismount(),
 * controller.riding, controller.rideCode(id) -> null | NOT_READY | OCCUPIED | LOCKED | NOT_FOUND). Cosmetic: the
 * farmer walks 1.8x faster. Null when the controller has no riding.
 */
function rideButton(ctx, v) {
  const c = ctx.controller;
  if (!c || typeof c.ride !== 'function') return null;
  const horse = (v.animals ?? []).find((a) => !a.baby && a.def?.id === 'horse')?.id ?? (v.animals ?? [])[0]?.id ?? null;
  const riding = Boolean(c.riding);
  const code = riding ? null : (typeof c.rideCode === 'function' ? c.rideCode(horse ?? undefined) : null);
  const why = code ? RIDE_TEXT[code] ?? 'Not right now' : '';
  const btn = h(`button.btn.pn-sm${riding ? '.btn--wood' : '.btn--sky'}.pc-ride`,
    { type: 'button', 'aria-disabled': code ? 'true' : null, title: why || null,
    on: { click: () => {
      if (code) { ctx.ui.toast(why, { kind: 'info' }); return; }
      if (riding) { c.dismount(); wrap.replaceWith(rideButton(ctx, v) ?? h('span')); }
      else { ctx.close?.(); c.ride(horse ?? undefined); }
    } } }, svgIcon('hand', 20), riding ? 'Get off' : 'Ride');
  const wrap = h('span.pc-ride-wrap', btn,
    h('small', riding ? 'You are riding: 1.8× faster' : why || 'Ride around the farm: 1.8× faster (V)'));
  return wrap;
}

/** The feed mill on the farm (for "Make Pig Slop"). */
function millId(state) {
  return Object.keys(state.farm.objects).sort().find((id) => state.farm.objects[id].def === 'feed_mill') ?? null;
}

/** The section under a new home's animals; null for the M1a homes (chickens, cows, sheep). */
export function m1bSection(v, ctx) {
  const st = ctx.store.state;
  const x = v && homeExtras(st, v.id, ctx.now());
  if (x && !v.animals) v = { ...v, animals: homeAnimals(st, v.id, ctx.now()) };
  if (!x) return null;
  const list = h('ul.pc-facts');
  const head = { pig: 'Truffle hunting', duck: 'Life on the pond', goat: 'The goat yard', horse: 'In the stable',
    bee: 'The hive' }[x.kind];
  const extra = [];
  switch (x.kind) {
    case 'pig':
      list.append(
        hintable(fact('pig_slop', `${x.feedName}: ${fmt(x.feedHave)} in the barn`,
          `The Feed Mill turns any ${x.slopIn} spare crops or fruit into ${x.slopOut} slop: the pigs eat your surplus.`), x.feed ?? 'pig_slop'),
        fact('truffle', `A ${x.productName} every ${fmtDuration(x.cycleMs).replace(/ 00m$/, '')}`,
          `Each dig: a ${x.premiumPct} % chance of a ${x.premiumName} once a pig has a blue ribbon.${x.woods ? ` In the Pig Woods they dig ${x.woodsPct} % faster.` : ''}`),
        x.fossilsLive ? fact('#star', 'Fossils turn up in the dirt',
          'Truffle digs, rocks and boulders can find an Ammonite, a Trilobite or an Arrowhead.') : null);
      if (x.fossilsLive) extra.push(albumLink(ctx, 'fossils', x.fossils, x.fossilsOf));
      {
        const mill = millId(st);
        if (mill && ctx.ui.panels.has('building')) extra.push(h('button.pn-chipbtn',
          { type: 'button', on: { click: () => ctx.open('building', { id: mill, focus: 'pig_slop' }) } },
            'Make Pig Slop'));
      }
      break;
    case 'duck':
      list.append(
        fact('duck_egg', `A ${x.productName} every ${fmtDuration(x.cycleMs).replace(/ 00m$/, '')}`,
          `Ducks eat ${itemOf(x.species.feed)?.name ?? 'Chicken Feed'} and paddle about the pond between meals.`),
        fact('golden_feather', `${x.premiumName}`,
          `A ${x.premiumPct} % chance on every collection from a blue-ribbon duck. It counts double at the Fair.`),
        x.feathersLive ? fact('#flower', 'Feathers for the album',
          'Collecting from ducks and chickens can find a Speckled, Barred or Copper Feather.') : null);
      if (x.feathersLive) extra.push(albumLink(ctx, 'feathers', x.feathers, x.feathersOf));
      break;
    case 'goat':
      list.append(
        fact('goat_milk', `${x.productName} every ${fmtDuration(x.cycleMs).replace(/ 00m$/, '')}`,
          `${fmt(x.inBarn)} in the barn. Each meal is ${x.species.feedQty} ${itemOf(x.species.feed)?.name ?? 'feed'}.`),
        fact('aged_goat_cheese', x.premiumName,
          `A ${x.premiumPct} % chance on every collection from a blue-ribbon goat.`),
        x.uses.length ? fact('#star', 'Good for', x.uses.map((u) => u.name).join(', ')) : null);
      break;
    case 'horse': {
      const b = x.barge;
      list.append(
        fact('#coin', `River Barge crates pay +${b.pct} %`,
          `Each grown horse pulls the cart to the jetty: +${b.each} % per horse, up to +${b.max} % (${b.adults} now).`,
            b.pct ? 'on' : ''),
        fact('manure', `${x.out} ${x.productName} every ${fmtDuration(x.cycleMs).replace(/ 00m$/, '')}`,
          `The Compost Bin turns each into ${x.compostPer} Compost.`),
        fact('show_ribbon', x.premiumName, 'A blue-ribbon horse sometimes brings home a Show Ribbon.'));
      const ride = rideButton(ctx, v);
      if (ride) extra.push(ride);
      break;
    }
    case 'bee': {
      const f = x.forage;
      const now = ctx.now();
      // the batch in the hive was timed when it started (forage counted then); the next one uses today's flowers
      const run = (v.animals ?? []).find((a) => a.status === 'producing' && a.start && a.end);
      const runMs = run ? run.end - run.start : null;
      const differs = runMs !== null && Math.abs(runMs - f.cycleMs) > 60_000;
      const span = (ms) => fmtDuration(ms).replace(/ 00m$/, '');
      const meter = h('div.pc-forage',
        { title: `Flower crops, flowering trees and flower decor within ${f.radius} tiles` },
        h('div.pc-forage-head',
          h('b', f.fast ? `Honey every ${span(f.cycleMs)}` : `Slow honey: every ${span(f.cycleMs)}`),
          pill(`${fmt(f.n)} flower${f.n === 1 ? '' : 's'} nearby · ${f.need} needed`, f.fast ? 'pn-owned' : 'pn-warn')),
        h('div.pc-forage-dots',
          ...Array.from({ length: Math.max(f.need, Math.min(8, f.n)) },
            (_, i) => h(`span${i < f.n ? '.on' : ''}`, { 'aria-hidden': 'true' }))),
        h('small', f.fast ? `Busy bees: ${f.sources.slice(0, 4).map((src) => defOf(src.def)?.name ?? cropOf(src.def)?.name ?? src.def).join(', ')}${f.sources.length > 4 ? '…' : ''}.`
          : `Plant flowers, a flowering tree or a Flower Bed within ${f.radius} tiles: with ${f.need} the hive makes honey twice as fast.`),
        differs ? h('small.pc-forage-now',
          `This batch was timed when it began (${span(runMs)}${run.end > now ? `, ready in ${fmtDuration(run.end - now)}` : ''}); the next one counts the flowers again.`) : null);
      list.append(
        fact('honey', `${x.productName}: ${fmt(x.inBarn)} in the barn`,
          `Bees need no feed. ${x.premiumName}: a ${x.premiumPct} % chance from a blue-ribbon colony.`),
        fact('#sprout', `Pollination +${x.pollinationPct} %`,
          `Crops and trees within ${f.radius} tiles of a busy hive: a bonus-unit chance.`),
        fact('beehive', `${x.hives} of ${x.hiveCap} hives`,
          x.hiveNextAt ? `One more hive at level ${x.hiveNextAt}.` : 'As many hives as the farm can hold.'));
      extra.unshift(meter);
      if (x.jarsLive) extra.push(albumLink(ctx, 'honey_jars', x.jars, x.jarsOf));
      break;
    }
    default:
  }
  return h(`section.pc-ani-m1b.pc-ani-${x.kind}`, { dataset: { m1b: x.kind } },
    h('h3.pn-h', h('span', head)), ...extra.filter((e) => e && e.classList?.contains('pc-forage')), list,
    h('div.pc-ani-links', ...extra.filter((e) => e && !e.classList?.contains('pc-forage'))));
}

// ---- giant crops ----------------------------------------------------------------------------------------------------

/** The banner of a giant event: giantFormed { id, ids, crop, by } or giantFelled { id, crop, qty, by, team }. Pure. */
export function giantText(state, ev, me) {
  const crop = cropOf(ev.crop);
  const name = crop?.name ?? 'crop';
  const who = (pid) => (pid === me ? 'You' : state.players[pid]?.name ?? 'Your partner');
  if (ev.e === 'giantFelled') {
    const units = `${fmt(ev.qty ?? 0)} ${pluralOf(name, ev.qty ?? 0)}`;
    return { kind: 'golden', ribbon: ev.team ? 'Felled together!' : 'Timber!',
      message: ev.team ? `The giant ${name} is down: ${units} for the barn, and one more for the Teamwork ribbon.` : `${who(ev.by)} brought the giant ${name} down: ${units} for the barn.` };
  }
  const G = COOP.giant ?? { hp: 60 };
  const lead = ev.by === me ? 'Your planting' : `${who(ev.by)}'s planting`;
  return { kind: 'quest', ribbon: 'A giant crop!',
    message: `${lead} finished a composted 3×3 block of ${pluralOf(name, 2)}, and it grew into one Giant ${name}. When it is ripe, fell it with the Axe: ${G.hp} points, 10 a chop, 15 when you chop right after each other.` };
}

export function giantBanners(ui, store, view) {
  const off = store.on('fx', ({ ev }) => {
    if (!ev || (ev.e !== 'giantFormed' && ev.e !== 'giantFelled')) return;
    const st = store.state;
    if (!st) return;
    const t = giantText(st, ev, store.pid);
    const anchor = own(st.farm.objects, ev.id);
    const felled = ev.e === 'giantFelled';
    const v = view || globalThis.__hh?.view;
    ui.banner({ id: `giant-${ev.id}-${felled ? 'f' : 'g'}`, kind: t.kind, ribbon: t.ribbon, message: t.message,
      things: ev.crop ? [{ icon: ev.crop, name: cropOf(ev.crop)?.name ?? ev.crop }] : [], ttl: felled ? 8000 : 12000,
      actions: !felled && anchor && v && typeof v.focus === 'function'
        ? [{ label: 'Show me', kind: 'sky',
          fn: () => { ui.panels.closeAll(); v.focus(anchor.x + 1, anchor.z + 1); } }] : [] });
  });
  return () => off?.();
}

// ---- new-unlock banners ---------------------------------------------------------------------------------------------

/** The panel a system unlock should open ("Show me"), for the lane's systems. */
export function featureTarget(id) {
  switch (id) {
    case 'collections': return { panel: 'collections', args: {} };
    case 'restoration': return { panel: 'restoration', args: {} };
    case 'farm_beauty': return { panel: 'beauty', args: {} };
    case 'decor_sets': return { panel: 'decorsets', args: { tab: 'sets' } };
    case 'masterwork': return { panel: 'decorsets', args: { tab: 'masterwork' } };
    case 'bees': return { panel: 'market', args: { tab: 'animals', focus: 'beehive' } };
    case 'truffles': return { panel: 'market', args: { tab: 'animals', focus: 'pig_pen' } };
    default: return null;
  }
}

const UNLOCK_TEXT = {
  collections: ['The Collections album is open',
    'Little treasures turn up while you farm. Whoever finds one, it goes in the album for both of you.',
      'Open the album'],
  restoration: ['A ruin to bring back',
    'The Restoration Ledger asks for goods, a piece at a time. The Old Greenhouse gives 12 plots beyond the cap, always in season.', 'Open the Ledger'],
  farm_beauty: ['Farm Beauty counts now',
    `Decor, buildings and trees add beauty. Each star pays ${FARM_BEAUTY.starAcorns} Acorns and makes orders pay 1 % more.`, 'See Farm Beauty'],
  decor_sets: ['Decor sets',
    'Place a themed set close together: +25 % beauty and a little magic. Masterwork upgrades your decor too.',
      'See the sets'],
  giant_crops: ['Giant crops',
    'Compost a 3×3 block of one crop and plant it within a minute: one block in five grows into a Giant. Fell it together.', null],
};

/** The lane's unlocks at a level: systems without a drip-feed card of their own, and restoration projects. Pure. */
export function unlocksOfLevel(level, state = null) {
  const out = [];
  // a project opens at its level only when the one before it is restored (the rules' openProject); with a state,
  // only the project that is open now is announced (the Ledger's own banner names the next one when one finishes)
  const open = state ? restoreA.openProject(state)?.id ?? null : undefined;
  for (const [id, [title, text, label]] of Object.entries(UNLOCK_TEXT)) {
    const f = featureOf(id);
    if (!f || !isLive(f) || f.unlock !== level || f.card) continue;
    out.push({ id, title, text, label, target: featureTarget(id) });
  }
  for (const p of CONTENT.restoration.values()) {
    if (!isLive(p) || p.unlock !== level || p.n === 1 || (open !== undefined && open !== p.id)) continue;
    out.push({ id: `restore-${p.id}`, title: `A new restoration: the ${p.name}`, text: p.text,
      label: 'Open the Ledger', target: { panel: 'restoration', args: { id: p.id } } });
  }
  return out;
}

export function unlockBanners(ui, store) {
  const off = store.on('celebrate', ({ ev }) => {
    if (!ev || ev.e !== 'levelUp' || ev.scope === 'player') return;
    const lvl = ev.level ?? levelFromXp(store.state?.farm?.xp ?? 0);
    // after the level-up banner and its unlock tour (about 3 s)
    setTimeout(() => {
      for (const u of unlocksOfLevel(lvl, store.state)) {
        ui.banner({ id: `unlock-${u.id}`, kind: 'card', ribbon: u.title, message: u.text, things: [], ttl: 20000,
          actions: u.label && u.target && ui.panels.has(u.target.panel) ? [{ label: u.label, kind: 'sky',
            fn: () => ui.panels.open(u.target.panel, u.target.args) }]
            : [{ label: 'Got it', kind: 'go', fn: () => {} }] });
      }
    }, 3600);
  });
  return () => off?.();
}

export { bar };
