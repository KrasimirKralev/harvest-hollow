// rules-economy wave-3 test helpers: the wave-2 helpers (./rules-economy.js) with the M2 content live in this test
// process, whatever MILESTONE the build ships. Import it FIRST (before anything under shared/): the milestone hook is
// registered when ./rules-economy.js loads, and it reads HH_TEST_MILESTONE at that moment.
process.env.HH_TEST_MILESTONE = 'M2';
const mod = await import('./rules-economy.js');

/** The modules an M2 rules test needs (the M1b set plus the wave-3 economy files), loaded under M2. */
export async function m2() {
  const M = await mod.m1b();
  if (M.content.MILESTONES.indexOf(M.content.MILESTONE) < 2) {
    throw new Error(`the M2 hook did not apply (MILESTONE ${M.content.MILESTONE})`);
  }
  const [breeding, fishing, interior, crafting, market] = await Promise.all([
    import('../../shared/rules/actions/breeding.js'),
    import('../../shared/rules/actions/fishing.js'),
    import('../../shared/rules/actions/interior.js'),
    import('../../shared/rules/actions/crafting.js'),
    import('../../shared/rules/actions/market.js'),
  ]);
  return { ...M, breeding, fishing, interior, crafting, market };
}

export const { withDefs } = mod;
