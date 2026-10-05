// Module hook (node:module register) for the wave-2 rules tests: loads shared/content/index.js with a later MILESTONE
// (default 'M1b'), so the content the rules support is live in that test process only. A no-op once the build ships
// that milestone or a later one.
const MILESTONE_RE = /export const MILESTONE = '(M1a|M1b|M2|M3)';/;
const RANK = { M1a: 0, M1b: 1, M2: 2, M3: 3 };
let want = 'M1b';

export async function initialize(data) {
  if (data && RANK[data.milestone] !== undefined) want = data.milestone;
}

export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (!url.endsWith('/shared/content/index.js')) return r;
  const src = String(r.source);
  const m = MILESTONE_RE.exec(src);
  if (!m || RANK[m[1]] >= RANK[want]) return r;
  return { ...r, source: src.replace(MILESTONE_RE, `export const MILESTONE = '${want}';`) };
}
