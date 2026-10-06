// Mini activity feed (GDD §6.4): bottom-left, the last 5 lines, fading after FEED.fadeMs (hover brings them back),
// every line in the actor's colour with a ♥ Thanks button for the partner's lines. Lines come from the replicated
// ring farm.feed (rules-goals, shared/rules/feed.js) plus local captions (partner joined, emotes, pings: GDD §7.5
// "important sounds have captions"). ui-shell lane.
//
//   feedText(row, state, me) -> { actor, text, icon }   one ring row as a sentence (pure; tests)
//   foldGiants(list, rowOf?, withRow?) -> list          a Giant's nine plots leave the harvest line (pure; tests)
//   createFeed(S) -> { push({ text, by?, icon?, glyph? }), render() }
import { CONTENT, FEED, FAIR, itemOf, defOf, pluralOf } from '../../../shared/content/index.js';
import * as CONTENT_ALL from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { feedRows } from '../../../shared/rules/feed.js';
import { h, icon, svgIcon, playerVars, playerMark } from './dom.js';
import { t, tn, tNodes, fmtNum, fmtDec, ordinal, ctext, N, Q, nameEntry } from '../i18n/index.js';
import { prep } from './goal-text.js';

/** A content name for a sentence: the Bulgarian ref when the names table has one, else the English the code holds. */
const nm = (id, en, family) => (nameEntry(id, family) ? N(id, family) : en);
/** An item's quantity ref ("12 Carrots" / "12 моркова"); an unknown id says "things". */
const qOf = (id, q) => (itemOf(id) ? Q(id, q, 'items') : `${fmtNum(q)} ${pluralOf(id || t('feed.things'), q)}`);
/** The English name of a def or a piece of land (the old wording), or null. */
const nameOfDef = (id) => (id ? (defOf(id)?.name) || CONTENT.expansions.get(id)?.name || String(id).replace(/_/g, ' ') : null);
/** A def as a sentence ref ({b}), or null. */
const defRef = (id) => {
  const en = nameOfDef(id);
  return en === null ? null : nm(id, en, CONTENT.expansions.has(id) && !defOf(id) ? 'expansions' : undefined);
};
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
    && !farmLine(row);
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
export function feedText(row, state, me) {
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
    case 'order': return out(row.g ? 'feed.order.golden' : 'feed.order', { n: row.c ?? 0 }, { icon: 'order_board' });
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
    case 'note': return out('feed.note', {}, { icon: null });
    case 'golden': return { ...line('feed.golden', {}, { icon: 'sunset_bench' }), actor: t('feed.golden.actor') };
    case 'hf': {
      const mine = isMe(row.a) || isMe(row.b);
      return { ...line(mine ? 'feed.hf.you' : 'feed.hf', {}, { icon: null }), actor: t('feed.hf.pair', { a: who(row.a), b: who(row.b) }) };
    }
    case 'gift': return out('feed.gift', {}, { icon: null });
    case 'chest': return out(row.what === 'meter' ? 'feed.chest.meter' : row.what === 'almanac' ? 'feed.chest.almanac' : 'feed.chest', {}, { icon: null });
    case 'name': return out(row.what === 'farm' ? 'feed.name.farm' : 'feed.name.animal', { text: row.text }, { icon: null });
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
  function patchLine(li, { at, by, actor, text, line: lineKey, params, iconId, glyph, thank }) {
    const p = by && store.state && Object.hasOwn(store.state.players, by) ? store.state.players[by] : null;
    const vars = p ? playerVars(p.color) : {};
    li.dataset.at = String(at);
    li.dataset.sig = `${actor}|${text}|${iconId || glyph || ''}|${thank ? 1 : 0}`;
    if (p) { li.style.setProperty('--fc', vars['--pc']); li.style.setProperty('--fcd', vars['--pcd']); li.style.setProperty('--fct', vars['--pct']); li.dataset.slot = by; }
    li.replaceChildren(...[
      iconId ? icon(iconId, { size: 24 }) : glyph ? svgIcon(glyph, 24) : null,
      h('span.txt', p && actor ? playerMark(by, p) : null, p && actor ? ' ' : null, sentence(actor, text, lineKey, params)),
      thank ? h('button.thanks', {
        // a farm-level line (a Fair medal) has no actor: thank the partner whose row it is, by name
        type: 'button', 'aria-label': t('feed.thank.aria', { name: p?.name ?? actor }), 'data-tip': t('feed.thank.tip', { name: p?.name ?? actor }),
        on: { click: (e) => { e.currentTarget.disabled = true; thank(); } },
      }, t('feed.thank.btn')) : null,
    ].filter(Boolean));
  }

  function render() {
    if (!store.state) return;
    const now = store.now();
    // two rows more than shown: a Giant's harvest line folded away still leaves MAX lines
    const rows = foldGiants(feedRows(store.state, MAX + 2), ([, r]) => r, ([i], r) => [i, r]).slice(0, MAX).map(([i, r]) => {
      const ft = feedText(r, store.state, store.pid);
      return {
        key: `r${i}`, at: r.at, by: r.by, actor: ft.actor, text: ft.text, line: ft.key, params: ft.params, iconId: ft.icon,
        glyph: ft.glyph,
        thank: canThank(i, r) ? () => { thanked.add(i); S.controller.do('thank', { i }); } : null,
      };
    });
    const loc = local.map((l, j) => ({ key: `l${j}-${l.at}`, at: l.at, by: l.by, actor: l.actor, text: l.text, iconId: l.icon, glyph: l.glyph }));
    const all = [...rows, ...loc].sort((a, b) => a.at - b.at).slice(-MAX);
    const keep = new Map([...list.children].map((li) => [li.dataset.key, li]));
    const next = all.map((l) => {
      const old = keep.get(l.key);
      if (!old) return lineEl(l);
      // a coalesced ring row keeps its key but grows ("harvested 12" -> "harvested 24"): patch the same <li>, never a
      // new one per update (a partner's long stroke used to churn thousands of nodes; QA wave 1 UI-31)
      if (old.dataset.at !== String(l.at) || old.dataset.sig !== `${l.actor}|${l.text}|${l.iconId || l.glyph || ''}|${l.thank ? 1 : 0}`) patchLine(old, l);
      return old;
    });
    // minimal DOM moves: a line that stays is never re-inserted (that would replay its slide-in)
    const keepSet = new Set(next);
    for (const li of [...list.children]) if (!keepSet.has(li)) li.remove();
    next.forEach((li, k) => { if (list.children[k] !== li) list.insertBefore(li, list.children[k] || null); });
    for (const li of next) li.classList.toggle('stale', now - Number(li.dataset.at) > fadeMs);
  }

  function push({ text, by = null, actor = null, icon: iconId = null, glyph = null, at = null }) {
    local.push({ at: Number.isFinite(at) ? at : store.now(), by, actor, text, icon: iconId, glyph });
    local.sort((a, b) => a.at - b.at);
    while (local.length > MAX) local.shift();
    render();
  }

  store.subscribe('feed', render);
  setInterval(() => {
    if (!store.state) return;
    const now = store.now();
    for (const li of list.children) li.classList.toggle('stale', now - Number(li.dataset.at) > fadeMs);
  }, 1000);

  return { push, render };
}
