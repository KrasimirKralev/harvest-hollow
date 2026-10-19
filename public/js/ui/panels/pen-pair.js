// Babies in the pen (wave 5, the owners' list 1 wish 1; they chose it over the Breeding Barn for everyday babies): from
// about level 8, two grown animals of one species in the same home are paired with the ❤ on the home's card; after about
// the species' baby time a baby appears in that pen, for both farmers, and is named like any animal. The Breeding Barn
// stays the place for rare coats. The rules decide everything (w5-rules.js reads them); this card only shows the pair,
// what it costs (one bottle or feed item), how long it takes, whether the home must grow for the baby, and the ❤.
//
//   pairSection(ctx, kit, homeId, sel) -> element | null    the card under the home's header (sel: { ids } the farmer's pick)
//   pairSig(state, homeId, now, sel) -> JSON-able           what the card draws (the panel's memo)
//   animalLabel(state, id) -> "Bella" | "Cow 2"             an animal's name, else its species and its place in the home
import { itemOf } from '../../../../shared/content/index.js';
import { h, icon, fmtDuration, bar } from './kit.js';
import { blockerText } from './model.js';
import { babyNoun } from './nursery.js';
import { pairView, pairIntent, pairCancelIntent, can5, pairOf } from './w5-rules.js';
import { t, tn, N, Q } from '../../i18n/index.js';

/** An animal's name, else its species and its number among its kind in its home ("Cow 2"). Pure. */
export function animalLabel(state, id) {
  const o = state?.farm?.objects?.[id];
  if (!o) return '';
  if (typeof o.name === 'string' && o.name) return o.name;
  const names = state.farm.names?.[id];
  if (typeof names === 'string' && names) return names;
  if (names && typeof names.name === 'string' && names.name) return names.name;
  const same = Object.keys(state.farm.objects).sort().filter((k) => state.farm.objects[k].home === o.home && state.farm.objects[k].def === o.def);
  return t('farm.pair.nth', { sp: N(o.def), n: same.indexOf(id) + 1 });
}

/** What the card draws, for the panel's memo (a partner's pair or a birth redraws it). Pure. */
export function pairSig(state, homeId, now, sel) {
  const v = pairView(state, homeId, now, sel?.ids ?? null);
  return [v.open, v.why, v.pick, v.running && [v.running.a, v.running.b, v.running.end, v.running.end <= now],
    v.adults.length, v.cost && [v.cost.item, v.cost.qty], v.room && [v.room.code, v.room.coins], v.level >= v.unlock, v.full, v.waiting,
    v.code ?? null, v.ms];
}

const word = (v) => (v.sp ? babyNoun(v.sp) : t('farm.pair.baby'));

/**
 * The ❤ card of a home (null when pairing is not for this home: a bee colony, a build without the rules, nothing to
 * pair and nothing to tease). `sel.ids` keeps the farmer's own pick between redraws; `sel.redraw()` draws the card again.
 */
export function pairSection(ctx, kit, homeId, sel = { ids: null }) {
  const st = ctx.store.state;
  const now = ctx.now();
  const v = pairView(st, homeId, now, sel.ids);
  if (v.why === 'live' || v.why === 'colony' || !v.sp) return null;
  const sp = N(v.sp);
  // below its level: one quiet line, so the owners know it is coming (only where a pair could live)
  if (v.why === 'level') {
    return h('p.pn-pair-teaser', h('span.pn-pair-heart', { 'aria-hidden': 'true' }, '❤'), t('farm.pair.teaser', { n: v.unlock, sp }));
  }
  const head = h('div.pn-pair-head', h('span.pn-pair-heart', { 'aria-hidden': 'true' }, '❤'), h('b', t('farm.pair.title')));
  if (v.running) return running(ctx, kit, homeId, v, head, sel);
  if (v.why === 'adults') {
    return h('section.pn-pair.pn-pair-quiet', { dataset: { pair: homeId } }, head, h('p.pn-pair-text', t('farm.pair.needTwo', { sp })));
  }
  // the pair: the two the ❤ proposes, the farmer may pick others (of one species)
  const pickIt = (id) => {
    const cur = v.pick.slice();
    if (cur.includes(id)) return;
    const a = v.adults.find((x) => x.id === id);
    const first = v.adults.find((x) => x.id === cur[1]);
    // the newest pick replaces the older one; another species starts a new pair with this one first
    sel.ids = first && first.def === a.def ? [cur[1], id] : [id];
    sel.redraw?.();
  };
  const chips = h('div.pn-pair-chips', { role: 'group', 'aria-label': t('farm.pair.pick') },
    ...v.adults.map((a) => {
      const on = v.pick.includes(a.id);
      return h(`button.pn-pair-chip${on ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(on), dataset: { key: `pair-${a.id}`, pairpick: a.id },
        on: { click: () => pickIt(a.id) } }, icon(a.def, { size: 30, alt: '' }), h('span', animalLabel(st, a.id)), on ? h('i', { 'aria-hidden': 'true' }, '❤') : null);
    }));
  const cost = v.cost && itemOf(v.cost.item)
    ? h(`span.pn-pair-cost${availableOf(st, v.cost.item) < v.cost.qty ? '.short' : ''}`, icon(v.cost.item, { size: 26, alt: '' }), t('farm.pair.cost', { q: Q(v.cost.item, v.cost.qty) }))
    : null;
  const room = roomLine(st, v, homeId);
  // the owners' homes are boxed in (wave 4b): the way out is one tap away, as in the Room row below
  const move = v.room && (v.room.code === 'BLOCKED' || v.room.code === 'OUT_OF_BOUNDS') && ctx.controller?.move
    ? h('button.pn-chipbtn.pn-pair-move', { type: 'button', dataset: { pairmove: homeId },
      on: { click: () => { ctx.close(); ctx.controller.move(homeId); } } }, t('farm.ani.moveHome', { home: homeRef(st, homeId) })) : null;
  const names = v.pick.map((id) => animalLabel(st, id));
  // the button asks for its type and its args one after the other: one fresh view serves both (it is not cheap)
  let fresh = null;
  const intentNow = () => {
    if (!fresh) { fresh = pairIntent(homeId, pairView(ctx.store.state, homeId, ctx.now(), sel.ids)); queueMicrotask(() => { fresh = null; }); }
    return fresh;
  };
  return h('section.pn-pair', { dataset: { pair: homeId } },
    head,
    h('p.pn-pair-text', t('farm.pair.intro', { sp, noun: word(v), d: fmtDuration(v.ms, { trim: true }) })),
    v.adults.length > 2 ? h('small.pn-pair-hint', t('farm.pair.pick')) : null,
    chips,
    h('div.pn-pair-foot', cost, room, move,
      kit.button({ label: t('farm.pair.go'), glyph: 'heart', cls: 'btn--sun pn-pair-go', key: `pair-go-${homeId}`,
        type: () => intentNow().type,
        args: () => intentNow().args,
        data: { pairgo: homeId }, title: names.length === 2 ? t('farm.pair.goTip', { a: names[0], b: names[1] }) : null,
        // the room line above already says why a full home cannot take a baby
        quiet: ['BLOCKED', 'OUT_OF_BOUNDS', 'CAP'],
        hint: () => ({ missing: v.cost ? [{ item: v.cost.item, n: v.cost.qty }] : [], unlock: v.unlock,
          coins: Math.max(0, (v.room?.coins ?? 0) - ctx.store.state.farm.wallet.coins),
          texts: { BLOCKED: t('farm.pair.noRoom', { why: blockerText(ctx.store.state, v.room?.blockers ?? []) }),
            OUT_OF_BOUNDS: t('farm.pair.noRoomEdge', { home: homeRef(ctx.store.state, homeId) }),
            CAP: t('farm.pair.noRoomShort'), FULL: t('farm.pair.noRoomShort'),
            ALREADY_DONE: t('farm.pair.busy'), OCCUPIED: t('farm.pair.busy'), NOT_READY: t('farm.pair.notGrown'), UNKNOWN_ACTION: t('farm.pair.soon') } }) })));
}

const homeRef = (state, homeId) => { const o = state.farm.objects[homeId]; return o ? N(o.def) : t('farm.home.generic'); };
const availableOf = (state, item) => (state.farm.inventory[item] ?? 0) + (state.farm.overflow?.[item] ?? 0);

/**
 * The home is full: the baby needs a free place, so the home grows one room step with the pairing (wave 4b, its price
 * folded in like buying one more animal), or says what stands in the way.
 */
function roomLine(state, v, homeId) {
  const r = v.room;
  if (!r) return null;
  if (r.code === 'BLOCKED') return h('small.pn-pair-room.bad', t('farm.pair.noRoom', { why: blockerText(state, r.blockers) }));
  if (r.code === 'OUT_OF_BOUNDS') return h('small.pn-pair-room.bad', t('farm.pair.noRoomEdge', { home: homeRef(state, homeId) }));
  if (r.code === 'CAP') return h('small.pn-pair-room.bad', t('farm.pair.noRoomShort'));
  if (r.coins > 0) return h('small.pn-pair-room', tn(r.grows ? 'farm.pair.roomGrows' : 'farm.pair.room', r.coins, { n: r.coins }));
  return v.full ? h('small.pn-pair-room', t('farm.pair.full', { home: homeRef(state, homeId) })) : null;
}

/** A pairing in progress: who, what is coming, when; the farmer may call it off (when the rules let them). */
function running(ctx, kit, homeId, v, head, sel) {
  const st = ctx.store.state;
  const r = v.running;
  const fill = bar(0, null, 'pn-thin pn-pair-bar');
  const line = h('span.pn-pair-when');
  const due = Number.isFinite(r.end) && r.end <= ctx.now();
  if (due && v.waiting) line.textContent = t('farm.pair.waiting', { noun: word(v), home: homeRef(st, homeId) });
  else if (!due && Number.isFinite(r.end)) {
    kit.timer(line, { end: r.end, start: Number.isFinite(r.start) ? r.start : undefined, bar: fill, prefix: t('farm.pair.in'), doneText: t('farm.pair.due'), done: () => sel.redraw?.() });
  } else line.textContent = t('farm.pair.due');
  if (due && v.waiting) line.classList.add('bad');
  const a = r.a ? animalLabel(st, r.a) : '';
  const b = r.b ? animalLabel(st, r.b) : '';
  const by = r.by && r.by !== ctx.store.pid && st.players[r.by] ? st.players[r.by].name : null;
  return h('section.pn-pair.pn-pair-on', { dataset: { pair: homeId, pairing: 'on' } },
    head,
    h('div.pn-pair-couple', r.a ? icon(st.farm.objects[r.a]?.def ?? r.sp, { size: 34, alt: '' }) : null, h('span.pn-pair-heart.big', { 'aria-hidden': 'true' }, '❤'),
      r.b ? icon(st.farm.objects[r.b]?.def ?? r.sp, { size: 34, alt: '' }) : null,
      h('div.pn-pair-who', h('b', a && b ? t('farm.pair.expecting', { a, b, noun: word(v) }) : t('farm.pair.expectingAny', { noun: word(v) })),
        by ? h('small', t('farm.pair.pairedBy', { name: by })) : null)),
    h('div.pn-pair-progress', fill, line),
    can5('pairCancel') && !due ? h('div.pn-pair-foot',
      kit.confirmButton({ label: t('farm.pair.cancel'), cls: 'pn-xs pn-ghost', confirm: t('farm.pair.cancelSure'), key: `pair-cancel-${homeId}`,
        type: () => pairCancelIntent(homeId).type, args: () => pairCancelIntent(homeId).args })) : null);
}

/** The ❤ tag on an animal card that is in a pairing. */
export const pairTag = () => h('span.pn-ani-pair', { title: t('farm.pair.tagTip') }, '❤ ', t('farm.pair.tag'));

/** "Bella and Daisy: a calf in 1h 12m" for a home's world card, or null. Pure (but for the language). */
export function pairTipLine(state, homeId, now) {
  // the world card refreshes every second while it is up: read the pairing alone, never the whole ❤ view
  const r = pairOf(state, homeId);
  if (!r) return null;
  const left = Number.isFinite(r.readyAt) ? r.readyAt - now : 0;
  return left > 0 ? t('farm.pair.tipIn', { noun: word({ sp: r.sp }), d: fmtDuration(left) }) : t('farm.pair.due');
}
