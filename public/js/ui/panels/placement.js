// Store -> build mode hand-off (ui-panels lane). Buying anything that stands on the farm opens the placement
// ghost for its def (GDD §7.1 build mode: green/red ghost, R rotates, click places, Esc cancels); the purchase
// itself is the `place` action the controller sends on the click, so it is predicted and checked like any other.
//
// The controller is client-core's: this calls the first placement entry point it offers
// (controller.place(def) | controller.build(def) | controller.setTool('hammer', { def })), closes the panel so the
// farm is visible, and tells the player what to do.
import { t } from '../../i18n/index.js';

export function startPlacement(ctx, defId) {
  const c = ctx.controller;
  let ok = false;
  try {
    if (typeof c.place === 'function') ok = c.place(defId) !== false;
    else if (typeof c.build === 'function') ok = c.build(defId) !== false;
    else if (typeof c.setTool === 'function') { c.setTool('hammer', { def: defId }); ok = true; }
  } catch (err) {
    console.error('placement failed to start', err);
    ok = false;
  }
  if (!ok) { ctx.ui.toast(t('farm.place.notReady')); return false; }
  ctx.close();
  return true;
}
