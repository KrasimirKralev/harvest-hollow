// Character customization (wave 4, owner wish 9 2026-10-04): hair style and colour, outfit colours, a hat and the skin
// tone, from the existing avatar rigs; saved per player in the game state, so the partner sees it at once and it
// follows the player to every device. Purely cosmetic: no rule reads it.
//
//   setAvatar {body?, hair?, hairColor?, skin?, top?, bottom?, hat?}   merges into my look (at least one field).
//                        Ids come from content's AVATAR_LOOKS when it publishes the catalog (else any lower-case id);
//                        colours are '#rrggbb'. BAD_ARGS otherwise; ALREADY_DONE when nothing changes.
//
// State: `players[pid].avatar = null | { body?, hair?, hairColor?, skin?, top?, bottom?, hat? }` (null = the slot's
// default look; the renderer already reads `avatar.body`: 'farmer_a' | 'farmer_b').
import * as C from '../../content/index.js';
import { ERR } from '../../net/protocol.js';
import { V } from '../schema.js';

/** The look fields and what each holds. */
export const AVATAR_IDS = Object.freeze(['body', 'hair', 'hat']);
export const AVATAR_COLORS = Object.freeze(['hairColor', 'skin', 'top', 'bottom']);
export const AVATAR_FIELDS = Object.freeze([...AVATAR_IDS, ...AVATAR_COLORS]);

const ID_RE = /^[a-z][a-z0-9_]{0,23}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** The catalog lists per id field (content's AVATAR_LOOKS; a field without a list takes any well-formed id). */
const CATALOG = C.AVATAR_LOOKS ?? {};
const LISTS = { body: CATALOG.bodies ?? ['farmer_a', 'farmer_b'], hair: CATALOG.hair ?? null, hat: CATALOG.hats ?? null };
const idsOf = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.id)) : null);

/** True when `v` is a valid value of look field `k`. Pure (state.js validates saves with it too). */
export function avatarValueOk(k, v) {
  if (AVATAR_COLORS.includes(k)) return typeof v === 'string' && COLOR_RE.test(v);
  if (!AVATAR_IDS.includes(k) || typeof v !== 'string' || !ID_RE.test(v)) return false;
  const ids = idsOf(LISTS[k]);
  return ids === null || ids.includes(v);
}

/** A player's stored look: null, or an object of valid fields only. */
export const avatarOk = (v) => v === null || (v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => avatarValueOk(k, x)));

export const setAvatar = {
  schema: Object.fromEntries(AVATAR_FIELDS.map((k) => [k, V.opt(V.text(24))])),
  check(state, a, ctx) {
    const keys = AVATAR_FIELDS.filter((k) => a[k] !== undefined);
    if (keys.length === 0) return ERR.BAD_ARGS;
    for (const k of keys) {
      const v = AVATAR_COLORS.includes(k) ? a[k].toUpperCase() : a[k];
      if (!avatarValueOk(k, v)) return ERR.BAD_ARGS;
    }
    const cur = state.players[ctx.pid]?.avatar ?? {};
    return keys.every((k) => cur[k] === (AVATAR_COLORS.includes(k) ? a[k].toUpperCase() : a[k])) ? ERR.ALREADY_DONE : null;
  },
  apply(tx, a, ctx) {
    const cur = tx.get(['players', ctx.pid, 'avatar']) ?? {};
    const next = { ...cur };
    for (const k of AVATAR_FIELDS) {
      if (a[k] !== undefined) next[k] = AVATAR_COLORS.includes(k) ? a[k].toUpperCase() : a[k];
    }
    tx.set(['players', ctx.pid, 'avatar'], next);
    tx.emit({ e: 'avatarChanged', pid: ctx.pid, avatar: { ...next }, by: ctx.pid });
  },
};
