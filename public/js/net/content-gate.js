// What a welcome whose hashes differ from this page's should do (review-m0 H4, coop-robust-11). DOM-free so node
// tests drive it. Owned by the client-core lane.
//
// The server hashes content once at boot, while shared/ is served from disk: after anyone edits shared/content
// (or bumps RULES_VERSION) on a running server, a reloaded page computes the NEW hash and the server keeps the
// old one. Reloading on every mismatch then loops forever, and a first claim's token was thrown away by the
// reload (a permanent lockout). So: the caller stores the welcome's token FIRST, then asks this gate; the
// page reloads at most once per server hash and otherwise shows the 'mismatch' state.
//
// Two hashes (SV-03):
//   contentHash  content + config + RULES_VERSION: a mismatch means the rules or numbers differ, so after one
//                reload that did not fix it the page must not play on ('mismatch')
//   buildHash    the bytes of public/** and shared/** (the server's, additive in welcome / api/status; the page's,
//                read at boot): a deploy of client code, or a rules change shipped without a RULES_VERSION bump.
//                It reloads once per server build; if that did not help the rules still agree, so the page
//                plays on ('ok') instead of locking the couple out over a hash of files
// A side that does not know its build hash (an older server, a page whose status fetch failed) skips that check.

import { tn } from '../i18n/index.js';

/**
 * @param {{ contentHash: string, buildHash?: string }} w   the welcome
 * @param {string | { content: string, build?: string | null }} local   this page's CONTENT_HASH (and build hash)
 * @param {{ get(): string|null, set(v: string): void }} memo  per-tab memory (sessionStorage 'hh.reloadedFor')
 * @returns {'ok' | 'reload' | 'mismatch'}
 */
export function contentGate(w, local, memo) {
  const mine = typeof local === 'string' ? { content: local, build: null } : { content: local.content, build: local.build ?? null };
  const contentOk = w.contentHash === mine.content;
  const buildOk = !w.buildHash || !mine.build || w.buildHash === mine.build;
  if (contentOk && buildOk) return 'ok';
  const key = contentOk ? `build:${w.buildHash}` : w.contentHash;
  if (memo.get() === key) return contentOk ? 'ok' : 'mismatch';
  memo.set(key);
  return 'reload';
}

/**
 * What a stale tab does with the actions it predicted while the server restarted, once the gate said 'reload'
 * (qa2 SV-01 / CL-02: they used to vanish with the reload, after the page had shown them done).
 *   'reload'   nothing unconfirmed: reload now
 *   'send'     the same rules (only the build differs): re-send the pending actions on this welcome, reload once
 *              every one is answered
 *   'note'     the rules changed: the actions were predicted under the old rules and are never re-sent (an index or
 *              an id may mean something else now, RC-07); the page remembers what was not saved and says so after
 *              the reload
 * The rules are "the same" when the content hash (content + config + RULES_VERSION) matches and, when the welcome
 * carries it, `rulesVersion` too.
 * @param {{ contentHash: string, rulesVersion?: number }} w
 * @param {{ content: string, rules?: number | null }} local
 * @param {number} pending   unconfirmed actions in the store
 * @returns {'reload' | 'send' | 'note'}
 */
export function reloadPlan(w, local, pending) {
  if (!(pending > 0)) return 'reload';
  const rulesOk = w.contentHash === local.content
    && (w.rulesVersion === undefined || local.rules === undefined || local.rules === null || w.rulesVersion === local.rules);
  return rulesOk ? 'send' : 'note';
}

/**
 * The actions of `pending` this welcome did not save: `lost` were never applied (above the server's lastSeq, or
 * settled but rejected while the tab was away), `unsure` have an unknowable outcome (the server forgot this cid).
 * @param {Array<{ seq: number }>} pending
 * @param {{ lastSeq?: number, known?: boolean, rejected?: Array<{ seq: number }> }} w
 * @returns {{ lost: number, unsure: number }}
 */
export function unsavedOf(pending, w) {
  const list = Array.isArray(pending) ? pending : [];
  if (w.known === false) return { lost: 0, unsure: list.length };
  const last = Number.isFinite(w.lastSeq) ? w.lastSeq : 0;
  const rejected = new Set((w.rejected || []).map((r) => r.seq));
  return { lost: list.filter((p) => p.seq > last || rejected.has(p.seq)).length, unsure: 0 };
}

/** Add `u` to the per-tab record of unsaved actions (sessionStorage 'hh.unsaved'), which survives the reload. */
export function noteUnsaved(memo, u) {
  const prev = memo.get() || {};
  const n = (k) => (Number.isFinite(prev[k]) ? prev[k] : 0) + (Number.isFinite(u[k]) ? u[k] : 0);
  const next = { lost: n('lost'), unsure: n('unsure') };
  if (next.lost || next.unsure) memo.set(next);
  return next;
}

/** The notice the reloaded page shows for a record of unsaved actions, or null when everything was saved. */
export function unsavedText(u) {
  const lost = u && Number.isFinite(u.lost) ? u.lost : 0;
  const unsure = u && Number.isFinite(u.unsure) ? u.unsure : 0;
  if (lost > 0) return tn('game.unsaved.lost', lost);
  if (unsure > 0) return tn('game.unsaved.unsure', unsure);
  return null;
}

/**
 * This page's build hash: a `<meta name="hh-build" content="...">` the server put into index.html, else the one
 * `/api/status` reported when the page booted (`buildHash`), else null (unknown: the build check is skipped).
 * @param {{ meta?: string | null, status?: object | null }} o
 */
export function pageBuild({ meta = null, status = null } = {}) {
  if (typeof meta === 'string' && meta) return meta;
  const s = status && (status.buildHash ?? status.build);
  return typeof s === 'string' && s ? s : null;
}
