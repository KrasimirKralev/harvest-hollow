// Mini activity feed (GDD §6.4): bottom-left, the last 5 lines, fading after FEED.fadeMs (hover brings them back),
// every line in the actor's colour with a ♥ Thanks button for the partner's lines. Lines come from the replicated
// ring farm.feed (rules-goals, shared/rules/feed.js) plus local captions (partner joined, emotes, pings: GDD §7.5
// "important sounds have captions"). life-feel lane.
//
//   feedText(row, state, me, { notes? }) -> { actor, text, icon }   one ring row as a sentence (pure; tests); notes:
//     false leaves out a surprise's quoted note (QA r1 L-01: the recap quotes it once, under "Gifts on your shelf")
//   giftNote(state, row) -> the giver's note of a surprise row, or null (QA r1 L-01; pure)
//   foldGiants(list, rowOf?, withRow?) -> list          a Giant's nine plots leave the harvest line (pure; tests)
//   createFeed(S) -> { push({ text, by?, icon?, glyph? }), render() }
// QA r2: L2-06 one collect's named animals make one line, and local lines never push the farm's rows out; L2-07 the
// recipient's "left you a surprise" line says where and pans to the box until it is opened; F2-02 a one-tap note in the
// reader's language (ui/goal-text.js noteText).
import { landRef } from './panels/w5-rules.js';
import { babyNoun } from './panels/nursery.js';
import { CONTENT, FEED, FAIR, itemOf, defOf, pluralOf } from '../../../shared/content/index.js';
import * as CONTENT_ALL from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { feedRows, renamedMine } from '../../../shared/rules/feed.js';
import { h, icon, svgIcon, playerVars, playerMark } from './dom.js';
import { t, tn, tNodes, fmtNum, fmtDec, ordinal, ctext, N, Q, nameEntry } from '../i18n/index.js';
import { prep, noteText } from './goal-text.js';
import { waitingBoxOf } from '../../../shared/rules/actions/coop.js';
import { dayIndex } from '../../../shared/rules/calendar.js';
import { LAYOUT_Q } from './layout.js';

/** D4 (features#F4, release 1.0): the name of a named animal (farm.names), or null. Pure. */
export const animalName = (state, id) => (typeof id === 'string' ? state?.farm?.names?.[id]?.name ?? null : null);

/**
 * D4: "Rada Petrova gave 2 Milk" once a farm day per named animal (a `collected` event from it, mine or the partner's).
 * `seen` maps an animal id to the day it last said so; returns the line { text, by, icon } or null. Pure but for `seen`.
 */
export function namedGave(ev, state, seen, day) {
  if (!ev || ev.e !== 'collected' || !(ev.qty > 0)) return null;
  const name = animalName(state, ev.id);
  if (!name || seen.get(ev.id) === day) return null;
  seen.set(ev.id, day);
  const item = ev.item || ev.product;
  const q = item && itemOf(item) ? Q(item, ev.qty, 'items') : String(ev.qty);
  return { text: t('cheer.named.gave', { name, q }), by: ev.by ?? null, icon: item || null, name, item: item || null, qty: ev.qty };
}

/**
 * QA r2 L2-06 (coop#4): the named animals of one collect as ONE line: "Rada Petrova gave 1 Milk", "Rada Petrova and
 * Ruja gave 2 Milk", "Rada Petrova, Ruja and 4 more gave 6 Milk". `lines` are namedGave lines of one farmer and item.
 * Pure.
 */
export function foldNamed(lines) {
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0];
  const [a, b] = lines;
  const n = lines.reduce((sum, l) => sum + (l.qty > 0 ? l.qty : 0), 0);
  const item = a.item;
  const q = item && itemOf(item) ? Q(item, n, 'items') : String(n);
  const names = lines.length === 2 ? t('cheer.named.two', { a: a.name, b: b.name }) : tn('cheer.named.more', lines.length - 2, { names: `${a.name}, ${b.name}` });
  return { text: t('cheer.named.gaveMany', { names, q }), by: a.by, icon: item };
}

/**
 * QA r1 L-01 (D1): the giver's note of a surprise feed row ('opened' / 'shelved'), or null. The rules keep the note on
 * the recipient's shelf row (written in the same action as the feed row: the same `at`, giver and item); a row that
 * carries `note` itself wins. Pure.
 */
export function giftNote(state, row) {
  if (!row) return null;
  if (typeof row.note === 'string' && row.note.trim()) return noteText(row.note.trim());
  const players = state?.players;
  const to = row.to;
  const from = row.from ?? row.by;
  const shelf = players && typeof to === 'string' && Object.hasOwn(players, to) ? players[to].shelf : null;
  if (!shelf || !shelf.rows) return null;
  for (const r of Object.values(shelf.rows)) {
    if (r && r.at === row.at && r.by === from && r.item === row.item && typeof r.note === 'string' && r.note.trim()) return noteText(r.note.trim());
  }
  return null;
}

/** A content name for a sentence: the Bulgarian ref when the names table has one, else the English the code holds. */
const nm = (id, en, family) => (nameEntry(id, family) ? N(id, family) : en);
/** An item's quantity ref ("12 Carrots" / "12 моркова"); an unknown id says "things". */
const qOf = (id, q) => (itemOf(id) ? Q(id, q, 'items') : `${fmtNum(q)} ${pluralOf(id || t('feed.things'), q)}`);
/** The English name of a def or a piece of land (the old wording), or null. */
const nameOfDef = (id) => (id ? (defOf(id)?.name) || landRef(id)?.en || String(id).replace(/_/g, ' ') : null);
/** A def as a sentence ref ({b}), or null. */
const defRef = (id) => {
  const en = nameOfDef(id);
  return en === null ? null : nm(id, en, landRef(id) && !defOf(id) ? landRef(id).family : undefined);
};
/** An animal species def, or null (an id the content no longer has). */
const animalOfSafe = (id) => { try { return CONTENT_ALL.animalOf(id) ?? null; } catch { return null; } };
/** "a" / "an" before an English name (English-only grammar: Bulgarian has no article). */
const an = (en) => (/^[aeiou]/i.test(String(en)) ? 'an' : 'a');
/** Fair points in tenths: "4.5" / "4,5" (always one decimal, as the feed always said). */
const pts10 = (p) => `${fmtNum(Math.floor((p ?? 0) / 10))}${fmtDec(1.5).charAt(1)}${(p ?? 0) % 10}`;

// A feed sentence holds its actor in the catalog ('{actor} harvested {q}'): the line on screen puts the farmer's name
// span there (tNodes); `text` is the sentence without the actor (every Bulgarian and English line starts with it), for
// the recap and the tests that read a line's words
const ACTOR = '\u2063';
/** { key, params, text, ...extra }: a catalog sentence and its words without the actor. */
export function feedLine(key, params = {}, extra = {}) { return line(key, params, extra); }
function line(key, params = {}, extra = {}) {
  const full = t(key, { ...params, actor: ACTOR });
  const at = full.indexOf(ACTOR);
  const text = prep(at < 0 ? full : `${full.slice(0, at)}${full.slice(at + ACTOR.length)}`.trim());
  return { key, params, text, ...extra };
}

/**
 * A line that is the farm's, not a farmer's (the farm's new level, a Fair ceremony, the Barge leaving): it names nobody,
 * so nobody is thanked for it, even when a farmer's action is what wrote it. Pure.
 */
export const farmLine = (row) => row?.k === 'level' || Boolean(m1bFeedText(row ?? {})?.sys);

/** Is `row` a line `pid` can thank: the other farmer's own line, not thanked yet (the Journal's Случки and the HUD). Pure. */
export function thankable(row, state, pid) {
  return Boolean(row) && row.by !== pid && row.by !== 'sys' && Object.hasOwn(state?.players ?? {}, row.by) && row.ty === undefined
    && !farmLine(row) && !renamedMine(row, pid);
}

/**
 * The M1b rows (the weekly and long-term systems, GDD §6.4 "always shown: giant crops, barge rows, Fair medals, Town
 * Projects") as { text, key, params, icon, sys? } without the actor, or null for any other kind. Pure; the Journal's
 * history (panels/goals-model.js) uses the same words. sys = the line is the farm's, not a player's.
 */
export function m1bFeedText(row) {
  const q = row.q ?? 0;
  switch (row.k) {
    case 'fair':
      if (row.medal !== undefined) {
        const m = row.medal ? FAIR.medals.find((x) => x.id === row.medal) : null;
        // M2: a league week adds the league move (rules-goals' ceremony row `lg` / `mv`)
        const move = !row.lg ? '' : row.mv > 0 ? '.up' : row.mv < 0 ? '.down' : '.still';
        const league = row.lg ? ctext('FAIR', `league.${row.lg}`, 'name', FAIR.league?.names?.[row.lg - 1] ?? t('feed.league', { n: row.lg })) : null;
        const params = { ...(m ? { medal: ctext('FAIR', `medal.${m.id}`, 'name', m.name), n: row.c ?? 0 } : {}), ...(league ? { league } : {}) };
        return line(`feed.fair.${m ? 'medal' : 'none'}${move}`, params, { sys: true, icon: 'ribbon_rosette' });
      }
      return line('feed.fair.enter', { q: qOf(row.item, q), p: pts10(row.p) }, { icon: row.item });
    case 'barge':
      if (row.row !== undefined) {
        return line(row.a ? 'feed.barge.rowA' : 'feed.barge.row', { row: row.row, nth: ordinal(row.row, 'm'), n: row.c ?? 0,
          ...(row.a ? { acorns: tn('common.acorns', row.a) } : {}) }, { icon: 'wooden_crate' });
      }
      return line('feed.barge.load', { q: qOf(row.item, q), n: row.c ?? 0 }, { icon: row.item });
    case 'folk': {
      const npc = CONTENT.npcs.get(row.npc);
      return line(npc?.name ? 'feed.folk' : 'feed.folk.any', { ...(npc?.name ? { npc: nm(row.npc, npc.name, 'npcs') } : {}), n: row.c ?? 0 },
        { icon: 'order_board' });
    }
    case 'album': {
      const set = CONTENT.collections.get(row.set);
      const setName = set ? ctext('collections', set.id, 'name', set.name) : '';
      if (row.done) return line('feed.album.done', { set: setName }, { glyph: 'star' });
      const it = set?.items.find((i) => i.id === row.item);
      return it ? line('feed.album.find', { _a: an(it.name), piece: ctext('finds', it.id, 'name', it.name) }, { icon: row.item, glyph: 'star' })
        : line('feed.album.findAny', {}, { icon: row.item, glyph: 'star' });
    }
    case 'giant': return line('feed.giant', { crop: itemOf(row.crop) ? N(row.crop, 'items') : row.crop, q: qOf(row.crop, q) }, { icon: row.crop });
    case 'restore': {
      const p = CONTENT.restoration.get(row.project);
      const proj = p ? nm(p.id, p.name, 'restoration') : null;
      if (row.done) return line(proj ? 'feed.restore.done' : 'feed.restore.doneAny', proj ? { p: proj } : {}, { icon: 'hammer' });
      const b = p?.bundles.find((x) => x.id === row.bundle);
      return line(proj ? 'feed.restore.bundle' : 'feed.restore.bundleAny', {
        b: b ? ctext('restoration', p.id, `bundles.${b.id}`, b.name) : '', ...(proj ? { p: proj } : {}) }, { icon: 'hammer' });
    }
    case 'town': {
      const tp = CONTENT.townProjects.get(row.id);
      return line(tp ? 'feed.town' : 'feed.town.any', tp ? { tp: nm(tp.id, tp.name, 'townProjects') } : {},
        { sys: true, icon: 'ferry_landing_souvenir' });
    }
    // ---- M2 (rules-goals): the Ribbon Track's season close, the Friendly Duel, Grandma's visit
    case 'track': {
      const season = String(row.s ?? '').split('-')[1] ?? '';
      const sk = ['spring', 'summer', 'autumn', 'winter'].includes(season) ? season : 'any';
      return line(`feed.track.${sk}${row.c ? '.c' : ''}`, { t: row.t ?? 0, ...(row.c ? { n: row.c } : {}) }, { sys: true, glyph: 'ribbon' });
    }
    case 'duel':
      if (row.what === 'start') return line('feed.duel.start', {}, { glyph: 'heart' });
      return line(row.tie ? 'feed.duel.tie' : 'feed.duel.end', {}, { sys: true, glyph: 'heart' });
    case 'grandma':
      return line(row.what === 'left' ? 'feed.grandma.left' : 'feed.grandma.here', {}, { sys: true, glyph: 'heart' });
    default: return null;
  }
}

/**
 * A Giant felled writes its own line ("felled a Giant Pumpkin! (55 Pumpkins)") and also adds the nine plots to the
 * actor's harvest stroke: that stroke line loses the Giant's units and plots, and goes when they were all of it, so
 * the feed never says it twice (QA2 UI-13). Display only: the ring and the Clean Sweep stroke stat keep the plots.
 * `list` holds ring rows (or anything `rowOf` reads a row from; `withRow` rebuilds an item with its new row). Pure.
 */
export function foldGiants(list, rowOf = (x) => x, withRow = (_x, row) => row) {
  const giants = list.map(rowOf).filter((r) => r && r.k === 'giant');
  if (!giants.length) return list;
  const used = new Set();
  const out = [];
  for (const x of list) {
    const r = rowOf(x);
    if (r && r.k === 'harvest') {
      let q = r.q ?? 0;
      let p = r.p;
      for (const g of giants) {
        // the Giant merged into the stroke row of the same farmer and crop, at its instant or just before it grew on
        if (used.has(g) || g.by !== r.by || g.crop !== r.item || r.at < g.at || r.at - g.at > FEED.coalesceMs) continue;
        used.add(g);
        q -= g.q ?? 0;
        if (Number.isSafeInteger(p)) p -= 9;
      }
      if (q !== (r.q ?? 0)) {
        if (q > 0) out.push(withRow(x, { ...r, q, ...(Number.isSafeInteger(p) ? { p: Math.max(1, p) } : {}) }));
        continue;
      }
    }
    out.push(x);
  }
  return out;
}

/**
 * A feed ring row as a short sentence: { actor, text, icon, glyph?, key, params }. Pure. `actor` is the farmer's
 * name ("You" / "Ти" for me), `text` the sentence without it; `key` / `params` say the whole sentence (tNodes puts the
 * actor in its place). Who is "you" is decided by pid, never by the words.
 */
export function feedText(row, state, me, { notes = true } = {}) {
  const players = (state && state.players) || {};
  const isMe = (pid) => pid === me;
  const who = (pid) => (isMe(pid) ? t('common.you') : (Object.hasOwn(players, pid) ? players[pid].name : t('feed.farm')));
  const actor = row.by === 'sys' ? t('feed.farm') : who(row.by);
  const q = row.q ?? 0;
  const out = (key, params, extra) => ({ actor, ...line(key, params, extra) });
  switch (row.k) {
    case 'harvest': return out('feed.harvest', { q: qOf(row.item, q) }, { icon: row.item });
    case 'tree': return out('feed.tree', { q: qOf(row.item, q) }, { icon: row.item });
    case 'collect': return out('feed.collect', { q: qOf(row.item, q) }, { icon: row.item });
    case 'tend': return out('feed.tend', { n: q }, { icon: 'feed_scoop' });
    case 'water': return out('feed.water', { n: q }, { icon: 'watering_can' });
    case 'craft': return out('feed.craft', { q: qOf(row.item, q) }, { icon: row.item });
    case 'sell': return out('feed.sell', { q: qOf(row.item, q), n: row.c ?? 0 }, { icon: 'coins' });
    case 'order': {
      // tk (1.0): a crate's Golden Ticket paid coins on top
      const key = row.tk ? 'feat.pu.order' : 'feed.order';
      return out(row.g ? `${key}.golden` : key, { n: row.c ?? 0, ...(row.tk ? { tk: row.tk } : {}) }, { icon: 'order_board' });
    }
    case 'level': return { ...line('feed.level', { level: row.level }, { icon: 'xp' }), actor: t('feed.farm') };
    case 'buy': {
      const b = defRef(row.def);
      // a slot is not a building, a Hurry is not a purchase of a thing (rules RC-20 rows carry `what`)
      if (row.what === 'slot') {
        return out(row.c ? 'feed.buy.slotFor' : 'feed.buy.slot', { b: b ?? t('feed.workshop'), ...(row.c ? { n: row.c } : {}) },
          { icon: row.def ?? 'hammer' });
      }
      // a crop finished with "Finish now" is not a batch (live requests 2026-10-04); a "Finish all" batch is one
      // coalesced row with q = plots finished
      if (row.what === 'hurry') {
        const many = row.q > 1;
        const key = row.def === 'plot' ? (many ? 'feed.hurry.crops' : 'feed.hurry.crop') : many ? 'feed.hurry.batches' : 'feed.hurry.batch';
        return out(key, { n: row.acorns ?? row.a ?? 0, ...(many ? { k: row.q } : {}) }, { icon: 'acorns' });
      }
      const en = nameOfDef(row.def) ?? t('feed.something');
      const key = `feed.buy${row.c && row.a ? '.ca' : row.c ? '.c' : row.a ? '.a' : ''}`;
      return out(key, { _a: an(en), b: b ?? en, ...(row.c ? { n: row.c } : {}), ...(row.a ? { acorns: tn('common.acorns', row.a) } : {}) },
        { icon: row.def });
    }
    case 'expand': return out('feed.expand', { land: defRef(row.def) ?? '' }, { icon: 'hammer' });
    case 'ribbon': {
      const rb = CONTENT.ribbons.get(row.id);
      return out(rb ? 'feed.ribbon' : 'feed.ribbon.any', rb ? { r: ctext('ribbons', rb.id, 'name', rb.name) } : {}, { icon: 'xp' });
    }
    case 'quest': {
      const qd = CONTENT.quests.get(row.id);
      return out(qd ? 'feed.quest' : 'feed.quest.any', qd ? { title: ctext('quests', row.id, 'title', qd.title) } : {}, { icon: null });
    }
    case 'keepsake': return out(isMe(row.to) ? 'feed.keepsake.you' : 'feed.keepsake', isMe(row.to) ? {} : { to: who(row.to) }, { icon: row.item });
    // release 1.0 D1 (features#F1): a surprise left on the porch (what is inside stays a secret), opened, or shelved by
    // the farm after 48 h (rules-features' row { k: 'surprise', what: 'left' | 'opened' | 'shelved', to, from?, item? })
    case 'surprise': {
      const item = row.item ? (itemOf(row.item) ? N(row.item, 'items') : String(row.item).replace(/_/g, ' ')) : '';
      // QA r1 L-01: the recipient's own line quotes the giver's note (it reached no screen before); L-07: the giver's
      // own shelved surprise is "Your surprise …", never "You's surprise …" / "Изненадата от Ти …"
      const note = notes && isMe(row.to) && !isMe(row.from) ? giftNote(state, row) : null;
      if (row.what === 'opened') {
        if (isMe(row.from)) return out('cheer.feed.openedYours', { from: who(row.from), item }, { icon: row.item || 'gift_box' });
        return out(note ? 'cheer.feed.openedNote' : 'cheer.feed.opened', { from: who(row.from), item, ...(note ? { note } : {}) },
          { icon: row.item || 'gift_box' });
      }
      if (row.what === 'shelved') {
        const key = isMe(row.from) ? 'cheer.feed.shelvedMine' : isMe(row.to) ? (note ? 'cheer.feed.shelvedYouNote' : 'cheer.feed.shelvedYou')
          : 'cheer.feed.shelved';
        return { actor: null, ...line(key, { from: who(row.from), to: who(row.to), item, ...(note ? { note } : {}) }, { icon: row.item || 'gift_box' }) };
      }
      // L2-07: the recipient's line says where the box waits (and the feed gives it Show me while it waits)
      if (isMe(row.to)) {
        const box = waitingBox(state, row);
        return out(box ? 'cheer.feed.leftYouPorch' : 'cheer.feed.leftYou', {}, { icon: 'gift_box', ...(box ? { box } : {}) });
      }
      return out('cheer.feed.left', { to: who(row.to) }, { icon: 'gift_box' });
    }
    case 'note': return out('feed.note', {}, { icon: null });
    case 'golden': return { ...line('feed.golden', {}, { icon: 'sunset_bench' }), actor: t('feed.golden.actor') };
    case 'hf': {
      const mine = isMe(row.a) || isMe(row.b);
      return { ...line(mine ? 'feed.hf.you' : 'feed.hf', {}, { icon: null }), actor: t('feed.hf.pair', { a: who(row.a), b: who(row.b) }) };
    }
    case 'gift': return out('feed.gift', {}, { icon: null });
    case 'chest': return out(row.what === 'meter' ? 'feed.chest.meter' : row.what === 'almanac' ? 'feed.chest.almanac' : 'feed.chest', {}, { icon: null });
    case 'name': return out(row.what === 'farm' ? 'feed.name.farm' : row.was !== undefined ? 'feed.name.renamed' : 'feed.name.animal',
      { text: row.text, was: row.was ?? '' }, { icon: null });
    case 'wish': {
      const w = defRef(row.def);
      const p = w ? { w } : {};
      const any = w ? '' : '.any';
      switch (row.what) {
        case 'deposit': return out(`feed.wish.deposit${any}`, { ...p, n: row.c ?? 0 }, { icon: row.def ?? 'coins' });
        case 'withdraw': return out(`feed.wish.withdraw${any}`, { ...p, n: row.c ?? 0 }, { icon: row.def ?? 'coins' });
        case 'bought': return { actor: null, ...line(`feed.wish.bought${any}`, p, { icon: row.def ?? 'star' }) };
        case 'asked': return out(`feed.wish.asked${any}`, p, { icon: row.def ?? 'coins' });
        case 'denied': return out(`feed.wish.denied${any}`, p, { icon: row.def ?? 'heart' });
        default: return out(`feed.wish.made${any}`, p, { icon: row.def ?? 'heart' });
      }
    }
    // wave 4 (the owners' wish list): rows the rules may write for upgrades, weeds and a new look
    case 'upgrade': case 'upgraded': {
      const b = defRef(row.def) ?? t('feed.theFarm');
      return out(row.name ? 'feed.upgrade.tier' : 'feed.upgrade', { b, ...(row.name ? { tier: row.name } : {}) }, { icon: row.def ?? 'hammer' });
    }
    case 'weed': case 'weeds':
      return out('feed.weed', { n: q > 1 ? q : 1 }, { icon: 'weed' });
    case 'look': case 'avatar':
      return out('feed.look', {}, { icon: null, glyph: 'smile' });
    // wave 4b (owner wishes 2026-10-05): a balloon crate opened (or gone to the Barn by itself), an Acorn treasure
    case 'crate': {
      const bits = [t('feed.crate.coins', { n: row.c ?? 0 })];
      if (row.a) bits.push(tn('common.acorns', row.a));
      if (row.g) bits.push(tn('feed.crate.golden', row.g));
      if (row.item) {
        const n = row.q > 1 ? row.q : 1;
        bits.push(t('feed.crate.item', { n, q: qOf(row.item, row.q ?? 1), _name: pluralOf(itemOf(row.item)?.name || row.item, row.q ?? 1) }));
      }
      if (row.def) {
        const en = nameOfDef(row.def) ?? t('feed.decorPiece');
        bits.push(t('feed.crate.decor', { _a: an(en), d: defRef(row.def) ?? en }));
      }
      if (row.pu) bits.push(t(`feat.pu.a.${row.pu}`));
      const loot = bits.length > 1 ? t('feed.crate.and', { list: bits.slice(0, -1).join(', '), last: bits.at(-1) }) : bits[0];
      if (row.auto || row.by === 'sys') return { actor: null, ...line('feed.crate.auto', { loot }, { icon: 'coins' }) };
      return out('feed.crate', { loot }, { icon: row.item ?? 'coins' });
    }
    case 'relic': {
      const rel = typeof CONTENT_ALL.relicOf === 'function' ? CONTENT_ALL.relicOf(row.def) : null;
      if (row.def === 'farmhand' && row.q !== undefined) {
        return { ...line(isMe(row.by) ? 'feed.farmhand.you' : 'feed.farmhand', { n: q, ...(isMe(row.by) ? {} : { for: actor }) },
          { icon: 'feed_scoop' }), actor: t('feed.farmhand.actor') };
      }
      if (row.def === 'time_turner' && row.q !== undefined) return out('feed.turner', { n: q }, { icon: 'acorns' });
      const en = rel?.name ?? nameOfDef(row.def);
      const r = en ? nm(row.def, en) : t('feed.aTreasure');
      return out(row.a ? 'feed.relic.a' : 'feed.relic', { r, ...(row.a ? { n: row.a } : {}) }, { icon: 'acorns' });
    }
    // wave 5 (the owners' wish list of 2026-10-05): babies in the pen, the dog that stays home, the bigger land
    case 'pen': {
      // a baby in the pen (rules progress: the pairing farmer's line): "Mia welcomed a newborn calf in the Cow Barn 🍼"
      const sp = typeof row.def === 'string' && animalOfSafe(row.def) ? row.def : null;
      const home = row.id && state?.farm?.objects?.[row.id]?.home;
      const hd = home && state.farm.objects[home] ? state.farm.objects[home].def : null;
      const p = { noun: sp ? babyNoun(sp) : t('farm.pair.baby') };
      return out(hd && defOf(hd) ? 'feed.pen.home' : 'feed.pen', hd && defOf(hd) ? { ...p, home: N(hd) } : p, { icon: sp, glyph: sp ? undefined : 'heart' });
    }
    case 'land': {
      const units = CONTENT.parcels instanceof Map ? [...CONTENT.parcels.values()] : [...CONTENT.expansions.values()];
      return { actor: null, ...line('feed.land.merged', { n: units.filter((e) => e.k > 0 && e.retired !== true).length }, { icon: 'plot', sys: true }) };
    }
    // multi-farm hosting: a farmer's new key (a lost phone), and their way back with it
    case 'key':
      if (row.what === 'back') return { actor: who(row.pid), ...line('feed.key.back', {}, { icon: null, glyph: 'lock' }) };
      return out(isMe(row.pid) ? 'feed.key.newMe' : 'feed.key.new', isMe(row.pid) ? {} : { name: who(row.pid) }, { icon: null, glyph: 'lock' });
    case 'keep': {
      if (!row.q) return out('feed.unkeep', { item: itemOf(row.item) ? N(row.item, 'items') : row.item, _name: pluralOf(itemOf(row.item)?.name || row.item || t('feed.things'), 2) }, { icon: row.item });
      return out(isMe(row.by) ? 'feed.keep.you' : 'feed.keep', { q: qOf(row.item, row.q) }, { icon: row.item });
    }
    default: {
      const m = m1bFeedText(row);
      if (m) return { ...m, actor: m.sys ? null : actor, icon: m.icon ?? null, glyph: m.glyph };
      return out(row.k ? 'feed.other.kind' : 'feed.other', row.k ? { k: row.k } : {}, { icon: null });
    }
  }
}

/** L2-07: the box a 'left' row's giver still has waiting on the porch for its recipient, or null. Pure. */
function waitingBox(state, row) {
  const id = state?.farm?.gifts ? waitingBoxOf(state, row.by) : null;
  const g = id ? state.farm.gifts[id] : null;
  return g && g.to === row.to && g.at === row.at && state.farm.objects?.[id] ? id : null;
}

/** The line's words: the whole catalog sentence with the actor's span in its place (a local caption: actor + text). */
function sentence(actor, text, key, params) {
  if (key) {
    const frag = tNodes(key, actor ? { ...params, actor: h('span.actor', actor) } : params);
    for (const n of frag.childNodes) if (n.nodeType === 3) n.textContent = prep(n.textContent);
    return frag;
  }
  return [actor ? h('span.actor', actor) : null, actor ? ' ' : null, text];
}

export function createFeed(S) {
  const { store } = S;
  const list = document.getElementById('feed');
  const local = [];           // { at, by, text, icon, glyph }
  const MAX = FEED.visibleLines || 5;
  const LOCAL_MAX = 2;
  const fadeMs = FEED.fadeMs || 8000;
  const thanked = new Set();  // ring indexes this tab already thanked (until the delta lands)

  function canThank(i, row) {
    return Boolean(ACTIONS.thank) && thankable(row, store.state, store.pid) && !thanked.has(i);
  }

  function lineEl(l) {
    const li = h('li', { dataset: { key: l.key } });
    patchLine(li, l);
    return li;
  }
  /** Fill (or refill in place) one line: a coalesced ring row grows ("harvested 12" -> "24") without a new <li>. */
  const sigOf = (l) => `${l.actor}|${l.text}|${l.iconId || l.glyph || ''}|${l.thank ? 1 : 0}|${l.show ? 1 : 0}`;
  function patchLine(li, l) {
    const { at, by, actor, text, line: lineKey, params, iconId, glyph, thank, show } = l;
    const p = by && store.state && Object.hasOwn(store.state.players, by) ? store.state.players[by] : null;
    const vars = p ? playerVars(p.color) : {};
    li.dataset.at = String(at);
    li.dataset.sig = sigOf(l);
    if (l.quiet) li.dataset.quiet = '1'; else delete li.dataset.quiet;
    if (p) { li.style.setProperty('--fc', vars['--pc']); li.style.setProperty('--fcd', vars['--pcd']); li.style.setProperty('--fct', vars['--pct']); li.dataset.slot = by; }
    li.replaceChildren(...[
      iconId ? icon(iconId, { size: 24 }) : glyph ? svgIcon(glyph, 24) : null,
      // L2-11 (fbp#10): the mark is the row's own flex item, centred with the words (inside their line box it sat 5 px low)
      p && actor ? playerMark(by, p) : null,
      h('span.txt', sentence(actor, text, lineKey, params)),
      // L2-07: a surprise still waiting on the porch: the way to it, not a thanks for a gift still closed
      show ? h('button.thanks.feed-show', { type: 'button', on: { click: () => show() } }, t('moments.showMe')) : null,
      thank ? h('button.thanks', {
        // a farm-level line (a Fair medal) has no actor: thank the partner whose row it is, by name
        type: 'button', 'aria-label': t('feed.thank.aria', { name: p?.name ?? actor }), 'data-tip': t('feed.thank.tip', { name: p?.name ?? actor }),
        on: { click: (e) => { e.currentTarget.disabled = true; thank(); } },
      }, t('feed.thank.btn')) : null,
    ].filter(Boolean));
  }

  // QA r3 S3-C2: a line with "Show me" to a waiting surprise does not fade until the box is opened (after 8 s nothing
  // led to it)
  // QA r4 L4-07: a Golden Hour line is history at once (its banner says it)
  const isStale = (li, now) => (li.dataset.quiet === '1' || now - Number(li.dataset.at) > fadeMs) && !li.querySelector('.feed-show');
  // L4-08: made in render() a line's callback held its `keep`, and so every line before it
  const showAt = (x, z) => () => S.view?.focus?.(x + 0.5, z + 0.5);
  const thankRow = (i) => () => { thanked.add(i); S.controller.do('thank', { i }); };

  function render() {
    if (!store.state) return;
    fitBeside();
    const now = store.now();
    // two rows more than shown: a Giant's harvest line folded away still leaves MAX lines
    const rows = foldGiants(feedRows(store.state, MAX + 2), ([, r]) => r, ([i], r) => [i, r]).slice(0, MAX).map(([i, r]) => {
      const ft = feedText(r, store.state, store.pid);
      const box = ft.box ? store.state.farm.objects[ft.box] : null;
      return {
        key: `r${i}`, at: r.at, by: r.by, actor: ft.actor, text: ft.text, line: ft.key, params: ft.params, iconId: ft.icon,
        glyph: ft.glyph,
        show: box ? showAt(box.x, box.z) : null,
        thank: !box && canThank(i, r) ? thankRow(i) : null,
        quiet: r.k === 'golden',
      };
    });
    // L2-06: local lines (captions, named animals) take at most LOCAL_MAX of the places the farm's rows need
    const loc = local.slice(-Math.max(LOCAL_MAX, MAX - rows.length))
      .map((l) => ({ key: `l${l.n}-${l.at}`, at: l.at, by: l.by, actor: l.actor, text: l.text, iconId: l.icon, glyph: l.glyph }));
    const all = [...rows, ...loc].sort((a, b) => a.at - b.at).slice(-MAX);
    const keep = new Map([...list.children].map((li) => [li.dataset.key, li]));
    const next = all.map((l) => {
      const old = keep.get(l.key);
      if (!old) return lineEl(l);
      // a coalesced ring row keeps its key but grows ("harvested 12" -> "harvested 24"): patch the same <li>, never a
      // new one per update (a partner's long stroke used to churn thousands of nodes; QA wave 1 UI-31)
      if (old.dataset.at !== String(l.at) || old.dataset.sig !== sigOf(l)) patchLine(old, l);
      return old;
    });
    // minimal DOM moves: a line that stays is never re-inserted (that would replay its slide-in)
    const keepSet = new Set(next);
    for (const li of [...list.children]) if (!keepSet.has(li)) li.remove();
    next.forEach((li, k) => { if (list.children[k] !== li) list.insertBefore(li, list.children[k] || null); });
    for (const li of next) li.classList.toggle('stale', isStale(li, now));
    keep.clear();
  }

  let localN = 0;
  function push({ text, by = null, actor = null, icon: iconId = null, glyph = null, at = null }) {
    local.push({ n: localN++, at: Number.isFinite(at) ? at : store.now(), by, actor, text, icon: iconId, glyph });
    local.sort((a, b) => a.at - b.at);
    while (local.length > MAX) local.shift();
    render();
  }

  // D4: a named animal says its name in the feed once a farm day (remembered per browser: a reload says it once too)
  const GAVE_KEY = 'hh.named.gave';
  const seen = new Map();
  try { for (const [id, d] of Object.entries(JSON.parse(localStorage.getItem(GAVE_KEY) || '{}'))) seen.set(id, d); } catch { /* no storage */ }
  // L2-06: one collect (one tap on a barn) sends its animals' events together: their names wait a moment and fold into
  // one line per farmer and good
  const gave = [];
  let gaveT = 0;
  const flushGave = () => {
    gaveT = 0;
    const groups = new Map();
    for (const l of gave.splice(0)) {
      const k = `${l.by}|${l.item}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    }
    for (const g of groups.values()) { const l = foldNamed(g); if (l) push(l); }
  };
  store.on?.('fx', ({ ev }) => {
    if (!ev || ev.e !== 'collected' || !store.state) return;
    let day = 0;
    try { day = dayIndex(store.now(), store.state.meta?.tz); } catch { day = Math.floor(store.now() / 86_400_000); }
    const l = namedGave(ev, store.state, seen, day);
    if (!l) return;
    gave.push(l);
    if (!gaveT) gaveT = setTimeout(flushGave, 60);
    try { localStorage.setItem(GAVE_KEY, JSON.stringify(Object.fromEntries([...seen].filter(([, d]) => d >= day - 1)))); } catch { /* no storage */ }
  });

  store.subscribe('feed', render);
  // a waiting surprise opened (or shelved): its line trades Show me for the thanks (L2-07)
  store.subscribe('gifts', render);

  // ---- QA r3 L3-03: a phone on its side with a sheet docked right: the lines wrap in the free farm left of it (they
  // ran under the sheet: the corner's 44vw knows nothing of it). Again after the slide-in, on resize, with the fade tick.
  function fitBeside() {
    if (!list || typeof list.getBoundingClientRect !== 'function') return;
    const name = S.ui?.panels?.top?.() ?? null;
    const frame = name ? document.getElementById(`panel-${name}`) : null;
    let cap = '';
    if (frame && typeof frame.getBoundingClientRect === 'function' && globalThis.matchMedia?.(LAYOUT_Q.land)?.matches) {
      const f = frame.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      const z = Number.parseFloat(globalThis.getComputedStyle?.(document.documentElement)?.getPropertyValue?.('--ui-scale')) || 1;
      if (f.width > 0 && f.right >= innerWidth - 4 && f.left > l.left) cap = `${Math.max(120, Math.floor((f.left - 12 - l.left) / z))}px`;
    }
    if (list.style.maxWidth !== cap) list.style.maxWidth = cap;
  }
  let fitT = 0;
  const refit = () => { fitBeside(); clearTimeout(fitT); fitT = setTimeout(fitBeside, 350); };
  S.ui?.panels?.on?.('open', refit);
  S.ui?.panels?.on?.('close', refit);
  globalThis.addEventListener?.('resize', refit);

  const fadeT = setInterval(() => {
    if (!store.state) return;
    const now = store.now();
    for (const li of list.children) li.classList.toggle('stale', isStale(li, now));
    if (list.style.maxWidth || S.ui?.panels?.top?.()) fitBeside();
  }, 1000);
  fadeT?.unref?.();

  return { push, render };
}
