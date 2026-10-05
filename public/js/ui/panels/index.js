// Content panels (ui-panels lane): the Market, the Barn, building / animal / tree panels, Mabel's orders,
// the Journal (story letters, This week, ribbons, mastery, stats, ledger, activity), notes, land and the
// Wishlist. Every panel registers into the shell's registry (ui/index.js `ui.panels.register`), which owns the
// frame, stacking, Esc, focus trap, hotkeys and the per-frame coalesced topic updates.
//
//   export default function install(ui, deps?)   called once by ui.init (the shell imports this file dynamically);
//                                         deps = { store } (or ui.store) lets the dock badges follow the farm
//
// Panel names the shell links (HUD pills, dock buttons, hotkeys): market (M, coins pill; args { tab }), barn
// (I, barn pill), orders (O), journal (J; args { tab }), notes (notes button), building { id }, animals { id },
// tree { id }, expansion { id }. Extra: wishlist, land.
import { marketPanel } from './market.js';
import { barnPanel } from './barn.js';
import { buildingPanel } from './building.js';
import { animalsPanel } from './animals.js';
import { treePanel } from './tree.js';
import { ordersPanel } from './orders.js';
import { journalPanel } from './journal.js';
import { notesPanel } from './notes.js';
import { wishlistPanel, expansionPanel } from './wishlist.js';
import { startBadges } from './badges.js';
import installCollect from './collections.js';
import { installWeekly, withDock } from './fair.js';
import { petsPanel } from './pets.js';
import { installLeague } from './league.js';
import installHome from './home.js';
import installW4 from './w4.js';
import installW4b from './w4b.js';
import { PETS } from '../../../../shared/content/index.js';
import { ensureStylesheet } from '../dom.js';

const CSS_HREF = '/css/panels.css';

/** The stylesheet is ours; until index.html links it, add the link once (idempotent). */
function ensureCss() {
  ensureStylesheet(CSS_HREF);
}

export const PANELS = Object.freeze({
  market: marketPanel,
  barn: barnPanel,
  building: buildingPanel,
  animals: animalsPanel,
  tree: treePanel,
  orders: ordersPanel,
  journal: journalPanel,
  notes: notesPanel,
  wishlist: wishlistPanel,
  expansion: expansionPanel,
});

export default function install(ui, deps = {}) {
  ensureCss();
  const off = [];
  for (const [name, spec] of Object.entries(PANELS)) off.push(ui.panels.register(name, spec));
  off.push(installWeekly(ui, deps));     // ui-weekly (wave 2): fair, fairCeremony, barge, townsfolk, town + dock minis
  const store = deps.store || ui.store || null;
  // pets (M1b, L10): adopt, treat and pet; a mini dock button once pets are open on this farm
  off.push(ui.panels.register('pets', withDock(petsPanel, PETS,
    { label: 'Pets', icon: 'dog_house', order: 9, mini: true, hint: 'Your dog or cat: adopt, a treat, a pat' },
    store || globalThis.__hh?.store || null)));
  // ui-collect (wave 2): the album, the Restoration Ledger, Farm Beauty, decor sets + Masterwork, the Ribbon Wall, the
  // M1b animal sections and their banners (collections.js is the lane's hub)
  off.push(installCollect(ui, { store }));
  // ui-league (wave 3): league, horse show, Ribbon Track, perks, Friendly Duel, Legacy (+ the Progress dock button)
  off.push(installLeague(ui, { store }));
  // ui-home (wave 3): farm atlas, barn ladder, Grand decor, farmhouse, nursery, breeding barn, fishing dock
  off.push(installHome(ui, { store }));
  // wave 4 (the owners' wish list): farm upgrades, selling stored decor, "Your look" (each loads on first open)
  off.push(installW4(ui, { store }));
  // wave 4b (owner wishes 2026-10-05): the balloon crates' loot card and lines, the treasures' "saving for"
  off.push(installW4b(ui, { store }));
  if (store) off.push(startBadges(ui, store));
  else {
    // no store handed over: start the badges with the first panel that opens (its ctx carries the store)
    const once = ui.panels.on('open', () => {
      const s = globalThis.__hh?.store;
      if (s) { off.push(startBadges(ui, s)); once(); }
    });
    off.push(once);
  }
  return () => { for (const f of off) f(); };
}
