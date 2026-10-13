// Hashes of a mod and of its compiled overlay (contract §1.9): FNV-1a over the canonical sorted-key JSON, the same
// canonical form shared/content/index.js uses for CONTENT_HASH (its own copy: the content module exports no helper).

/** Canonical JSON: object keys sorted at every depth, arrays in order. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 8-hex FNV-1a of a string. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The hash of a mod: its files map { path: parsedJson }. */
export const modHash = (files) => fnv1a(canonical(files ?? {}));

/** The hash of a compiled overlay, without its own `hash` field. */
export function overlayHash(overlay) {
  const { hash: _drop, ...rest } = overlay ?? {};
  return fnv1a(canonical(rest));
}
