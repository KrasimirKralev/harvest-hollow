// rules-economy wave-2 test helpers: run a test file against the M1b content while the build still plays M1a.
//
// Import this module FIRST and load everything under shared/ (and the test helpers that import it) with `await
// m1b()` or dynamic import(): the module hook below must be registered before shared/content/index.js is loaded
// in this process (node --test runs every test file in its own process).
import { register } from 'node:module';

// HH_TEST_MILESTONE picks a later milestone for one test file (the pets test runs under M2): set it in that file
// before importing this module (process.env, so it travels to the hook thread through `data`).
register('./rules-economy-hooks.mjs', import.meta.url, { data: { milestone: process.env.HH_TEST_MILESTONE ?? 'M1b' } });

/** The modules an M1b rules test needs, loaded under the M1b milestone. */
export async function m1b() {
  const [content, index, state, grid, gridCache, economy, helpers, rulesHelpers] = await Promise.all([
    import('../../shared/content/index.js'),
    import('../../shared/rules/index.js'),
    import('../../shared/rules/state.js'),
    import('../../shared/rules/grid.js'),
    import('../../shared/rules/grid-cache.js'),
    import('../../shared/rules/economy.js'),
    import('../helpers.js'),
    import('./rules.js'),
  ]);
  const [animals, beauty, restoration, town, giant, trees, farming, decor, expansions, boosts] = await Promise.all([
    import('../../shared/rules/actions/animals.js'),
    import('../../shared/rules/actions/beauty.js'),
    import('../../shared/rules/actions/restoration.js'),
    import('../../shared/rules/actions/town.js'),
    import('../../shared/rules/actions/giant.js'),
    import('../../shared/rules/actions/trees.js'),
    import('../../shared/rules/actions/farming.js'),
    import('../../shared/rules/actions/decor.js'),
    import('../../shared/rules/actions/expansions.js'),
    import('../../shared/rules/actions/boosts.js'),
  ]);
  if (content.MILESTONES.indexOf(content.MILESTONE) < 1) {
    throw new Error(`the M1b hook did not apply (MILESTONE ${content.MILESTONE})`);
  }
  return { content, index, state, grid, gridCache, economy, helpers, rulesHelpers, animals, beauty, restoration, town,
    giant, trees, farming, decor, expansions, boosts };
}

/**
 * Add fixture placeable defs for the length of `fn` (content Maps are read-only; tests use Map.prototype.set.call
 * and delete the def again, common.md). `family` is a content Map family ('landmarks', 'decor', ...).
 */
export function withDefs(content, family, defs, fn) {
  for (const d of defs) {
    Map.prototype.set.call(content.CONTENT[family], d.id, d);
    Map.prototype.set.call(content.PLACEABLES, d.id, d);
  }
  const done = () => {
    for (const d of defs) {
      Map.prototype.delete.call(content.CONTENT[family], d.id);
      Map.prototype.delete.call(content.PLACEABLES, d.id);
    }
  };
  let r;
  try { r = fn(); } catch (e) { done(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(done);
  done();
  return r;
}
