// One door for every lazy import() (QA r4 I4-01). A module whose fetch failed stays failed for the page (the browser
// keeps it in its module map), so only a reload brings it (main.js). lazyImport() rethrows; on a failed fetch, never on
// an error the module threw, it dispatches 'hh:assets-failed' { name, why }.
export const IMPORT_FAILED = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
export const importFailed = (err) => IMPORT_FAILED.test(String(err?.message ?? err ?? ''));

export function noteImportFailure(name, err) {
  const why = String(err?.message ?? err ?? '').slice(0, 160);
  try { console.warn(`a game file did not load (${name}): ${why}`); } catch { /* no console */ }
  try { globalThis.dispatchEvent?.(new CustomEvent('hh:assets-failed', { detail: { name, why } })); } catch { /* no DOM */ }
}

/** 'reload' while the curtain is up and this tab reloaded fewer than `max` times in `windowMs` (no loop), else 'notice'. */
export function recoverPlan({ lifted, recent = [], now, max = 2, windowMs = 300_000 }) {
  const n = recent.filter((at) => at <= now && now - at < windowMs).length;
  return !lifted && n < max ? 'reload' : 'notice';
}

/** lazyImport('panels', () => import('./panels/index.js')): the import, a failed fetch reported, then rethrown. */
export function lazyImport(name, load) {
  return Promise.resolve().then(load).catch((err) => {
    if (importFailed(err)) noteImportFailure(name, err);
    throw err;
  });
}
