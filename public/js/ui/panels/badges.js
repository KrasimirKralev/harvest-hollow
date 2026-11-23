// Dock / pill badges of the content panels (ui-panels lane): what is waiting for the player behind each panel, so
// the farm says "come and look" without a pop-up (GDD §7.3: cards bounce with a "!" until looked at).
//   orders   number of orders the Barn can fill right now
//   journal  "!" when a letter can be handed in or today's Daily Gift is still closed
//   barn     "!" while the Barn overflows
//   market   "!" while the partner waits for my answer about the coins of one of my wishes (QA wave 1 UI-10)
// Pure part: badgesFor(state, pid, now) -> { orders, journal, barn } (tested in node); the DOM part only calls the
// shell's ui.panels.badge(name, value, tone), at most twice a second. BADGE_TONE: orders and the Journal only have
// something to do (a calm badge); the Barn spilling and the partner's question stay red (QA2 UI-03).
import { boardSlots, shortfall, storyView, giftView } from './goals-model.js';
import { barnView, levelOf } from './model.js';
import { ORDERS } from '../../../../shared/content/index.js';

export const BADGE_TONE = Object.freeze({ orders: 'calm', journal: 'calm', barn: null, market: null });

export function badgesFor(state, pid, now) {
  if (!state || !state.farm) return { orders: null, journal: null, barn: null, market: null };
  const level = levelOf(state);
  const ready = level < ORDERS.unlock ? 0 : boardSlots(state).filter((s) => s.order && shortfall(state, s.order).length === 0).length;
  const story = storyView(state, now);
  const letter = story.active.some((q) => q.deliver && q.ready);
  const gift = giftView(state, now);
  const giftOpen = Boolean(gift && gift.open && !gift.claimed);
  const b = barnView(state);
  const asked = Object.values(state.farm.wishlist ?? {}).some((w) => w && w.by === pid && w.release && w.release.by !== pid);
  return {
    orders: ready > 0 ? ready : null,
    journal: letter || giftOpen ? '!' : null,
    barn: b.status === 'overflow' || b.status === 'full' ? '!' : null,
    market: asked ? '!' : null,
  };
}

/** Keep the dock badges current from store changes (throttled); returns a stop function. */
export function startBadges(ui, store) {
  if (!ui || !ui.panels || typeof ui.panels.badge !== 'function' || !store || typeof store.on !== 'function') return () => {};
  let timer = 0;
  const run = () => {
    timer = 0;
    try {
      const b = badgesFor(store.state, store.pid, store.now());
      for (const [name, v] of Object.entries(b)) if (ui.panels.has(name)) ui.panels.badge(name, v, BADGE_TONE[name] ?? null);
    } catch (err) {
      console.error('panel badges failed', err);
    }
  };
  const off = store.on('change', () => { if (!timer) timer = setTimeout(run, 500); });
  const tick = setInterval(run, 30_000);         // the day turns, orders refill: time alone changes badges too
  run();
  return () => { off?.(); clearInterval(tick); clearTimeout(timer); };
}
