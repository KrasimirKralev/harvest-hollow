// The ui-home lane's install hub (w3, M2): registers every ui-home panel into the shell's registry, links the lane's
// stylesheet, keeps the small dock buttons of the systems that are open and their badges, and the coat-reveal / visit
// banners. Called once from ui/panels/index.js (`off.push(installHome(ui, { store }))`); idempotent, and it never
// replaces a panel name another lane registered first.
//
// Panels (names the other lanes, the Goal Tracker and "Show me" may open):
//   landmap        the farm atlas: all 15 expansions + the Hollow Meadow, the next parcel's card (args { id? })
//   barnUpgrades   the Barn's upgrade ladder 1-10 with the growing barn
//   grandDecor     the Grand decor showroom (args { focus? })
//   farmhouse      the farmhouse: the room, Restoration 4-6, Grandma's visit (args { tab?: 'room'|'restore'|'grandma' })
//   breeding       the Breeding Barn: pick a pair, the coat odds, the baby on the way (args { species? })
//   nursery        the Animal Nursery: the care card of each baby (args { id? })
//   fishing        the Fishing Dock's board: casts, cooldowns, trophies, the week's biggest, Pond Treasures
// Dock minis (mini: true; shown only while the system is open): Farmhouse (Restoration 4 on, L25), Nursery (L19-27;
// from L28 the Breeding Barn's button, whose panel switches to the Nursery), Fishing (a fishing spot on the farm).
import { INTERIOR, CONTENT, FISHING, isLive } from '../../../../shared/content/index.js';
import { ensureStylesheet } from '../dom.js';
import { levelOf } from './core.js';
import { landmapPanel } from './expansions-map.js';
import { barnUpgradesPanel } from './barn-upgrades.js';
import { grandDecorPanel } from './grand-decor.js';
import { farmhousePanel, farmhouseBadge } from './farmhouse.js';
import { nurseryPanel, nurseryBadge, nurseryIsOpen, babyNoun } from './nursery.js';
import { breedingPanel, breedingBadge, breedingIsOpen, coatName } from './breeding.js';
import { fishingPanel, fishingBadge, fishingView } from './fishing.js';
import { t, has, lang, ctext } from '../../i18n/index.js';

const CSS_HREF = '/css/panels-home.css';

/** The level the farmhouse panel opens at: the first live Restoration project it shows (4: Orchard Pond, L25). */
function farmhouseFrom() {
  const p = [...CONTENT.restoration.values()].filter((x) => x.n >= 4 && isLive(x)).sort((a, b) => a.n - b.n)[0];
  return p ? p.unlock : null;
}

/** When each mini shows (pure: tests drive it with a state). */
export function homeDocks(state, now) {
  if (!state || !state.farm) return { farmhouse: false, nursery: false, breeding: false, fishing: false };
  const level = levelOf(state);
  const from = farmhouseFrom();
  const breeding = breedingIsOpen(state);
  let fishing = false;
  try { const v = fishingView(state, null, now); fishing = v.live && v.spots.length > 0; } catch { fishing = false; }
  return {
    farmhouse: Boolean(INTERIOR) && from !== null && level >= from,
    nursery: nurseryIsOpen(state) && !breeding,
    breeding,
    fishing,
  };
}

// labels and hints are getters: the dock reads them when it draws, so they follow the language
const dock = (name, icon, order) => ({ get label() { return t(`home.dock.${name}`); }, icon, order, mini: true,
  get hint() { return t(`home.dock.${name}Hint`); } });
const DOCKS = {
  farmhouse: dock('farmhouse', 'farmhouse', 10),
  nursery: dock('nursery', 'baby_bottle', 11),
  breeding: dock('breeding', 'baby_bottle', 11),
  fishing: dock('fishing', 'pond_dock', 12),
};

/** A panel spec whose dock button exists only while `homeDocks()[name]` says so (read on every dock render). */
function docked(spec, name, store) {
  return Object.defineProperty({ ...spec }, 'dock', {
    enumerable: true,
    get: () => {
      const st = store?.state;
      if (!st) return null;
      try { return homeDocks(st, store.now ? store.now() : Date.now())[name] ? DOCKS[name] : null; } catch { return null; }
    },
  });
}

let installed = null;

export default function installHome(ui, deps = {}) {
  if (installed) return installed;
  ensureStylesheet(CSS_HREF);
  const store = deps.store || ui.store || globalThis.__hh?.store || null;
  const PANELS = {
    landmap: landmapPanel,
    barnUpgrades: barnUpgradesPanel,
    grandDecor: grandDecorPanel,
    farmhouse: docked(farmhousePanel, 'farmhouse', store),
    nursery: docked(nurseryPanel, 'nursery', store),
    breeding: docked(breedingPanel, 'breeding', store),
    fishing: docked(fishingPanel, 'fishing', store),
  };
  const off = [];
  for (const [name, spec] of Object.entries(PANELS)) {
    if (!ui.panels.has(name)) off.push(ui.panels.register(name, spec));
  }
  if (store && typeof store.on === 'function' && typeof ui.panels.badge === 'function') off.push(startHomeBadges(ui, store));
  if (store && typeof store.on === 'function' && typeof ui.banner === 'function') off.push(homeBanners(ui, store));
  installed = () => { for (const f of off) { try { f?.(); } catch { /* already gone */ } } installed = null; };
  return installed;
}

/** The ui-home badges (pure part, tested): a count or '!' per panel, and its tone. */
export function homeBadges(state, pid, now) {
  return {
    nursery: { v: nurseryBadge(state, pid, now), tone: 'calm' },
    breeding: { v: breedingBadge(state, pid, now) ?? (breedingIsOpen(state) ? nurseryBadge(state, pid, now) : null), tone: 'calm' },
    fishing: { v: fishingBadge(state, pid, now), tone: 'calm' },
    farmhouse: { v: farmhouseBadge(state, pid, now), tone: null },
  };
}

function startHomeBadges(ui, store) {
  let timer = 0;
  const run = () => {
    timer = 0;
    try {
      const b = homeBadges(store.state, store.pid, store.now());
      for (const [name, { v, tone }] of Object.entries(b)) if (ui.panels.has(name)) ui.panels.badge(name, v, tone);
    } catch (err) {
      console.error('ui-home badges failed', err);
    }
  };
  const off = store.on('change', () => { if (!timer) timer = setTimeout(run, 600); });
  const tick = setInterval(run, 30_000);       // cooldowns and care steps end with time alone
  run();
  return () => { off?.(); clearInterval(tick); clearTimeout(timer); };
}

// ---- banners: the moments of the home systems the other farmer should not miss -------------------------------------

const who = (state, pid, me) => (pid === me ? t('common.you') : state?.players?.[pid]?.name ?? t('common.partner'));

/**
 * The banner of an ui-home event, or null (pure, tested): the partner's new baby, a record fish someone else landed,
 * Grandma's arrival and her leaving, the farmhouse room opening. Own baby and own fish show in their own panel / the
 * cast's card instead.
 */
export function homeBannerOf(state, ev, me) {
  if (!ev || !state) return null;
  switch (ev.e) {
    case 'bred': {
      if (ev.by === me) return null;
      const noun = babyNoun(ev.species);
      const coat = ev.golden ? 'golden' : lang() === 'en' ? coatName(ev.coat).toLowerCase() : coatName(ev.coat); // i18n-ok: the English word
      const adjKey = `home.breed.coatN.${ev.golden ? 'golden' : ev.coat}`;
      const p = { who: who(state, ev.by, me), name: ev.name, coat, adj: has(adjKey) ? t(adjKey) : coat, noun };
      return { id: `bred-${ev.id}`, kind: 'quest', ribbon: t('home.banner.baby'), ttl: 9000,
        message: ev.name ? t('home.banner.bredNamed', p) : t('home.banner.bred', p),
        panel: ['nursery', { id: ev.id }], label: t('home.banner.babyCard') };
    }
    case 'fishCaught': {
      if (ev.by === me || !ev.record || ev.joke) return null;
      const f = FISHING?.fish?.find((x) => x.id === ev.fish);
      return { id: `fish-${ev.fish}-${ev.cm}`, kind: 'quest', ribbon: t('home.banner.record'), ttl: 8000,
        message: t('home.banner.recordText', { who: who(state, ev.by, me), cm: ev.cm,
          fish: f ? ctext('FISHING', `fish.${f.id}`, 'name', f.name) : t('home.banner.fish') }),
        panel: ['fishing', {}], label: t('home.fish.board') };
    }
    case 'grandmaArrived':
      return { id: 'grandma-arrived', kind: 'golden', ribbon: t('home.banner.grandma'), ttl: 14000,
        message: t('home.banner.grandmaText'),
        panel: ['farmhouse', { tab: 'grandma' }], label: t('home.banner.whereIsShe') };
    case 'grandmaLeft':
      return { id: 'grandma-left', kind: 'golden', ribbon: t('home.banner.grandmaLeft'), ttl: 14000,
        message: t('home.banner.grandmaLeftText'), panel: ['farmhouse', { tab: 'grandma' }], label: t('home.banner.herLetter') };
    case 'interiorOpened':
      return { id: 'interior-opened', kind: 'golden', ribbon: t('home.banner.houseYours'), ttl: 12000,
        message: t('home.banner.houseText'), panel: ['farmhouse', { tab: 'room' }],
        label: t('home.banner.goInside') };
    default:
      return null;
  }
}

function homeBanners(ui, store) {
  const off = store.on('fx', ({ ev }) => {
    let b = null;
    try { b = homeBannerOf(store.state, ev, store.pid); } catch (err) { console.error('ui-home banner failed', err); }
    if (!b) return;
    // functions: a language switch while the card is up says it again (from the same event and farm)
    const st = store.state;
    const again = () => { try { return homeBannerOf(st, ev, store.pid) ?? b; } catch { return b; } };
    ui.banner({ id: b.id, kind: b.kind, ribbon: () => again().ribbon, message: () => again().message, things: [], ttl: b.ttl,
      actions: [{ label: () => again().label, kind: 'sky', fn: () => ui.panels.open(b.panel[0], b.panel[1]) }] });
  });
  return () => off?.();
}

export const HOME_PANELS = Object.freeze(['landmap', 'barnUpgrades', 'grandDecor', 'farmhouse', 'nursery', 'breeding', 'fishing']);
