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
import { h, icon, svgIcon, fmt, playerVars, playerMark } from './dom.js';

const nameOfItem = (id, q) => {
  const it = itemOf(id);
  const n = (it && it.name) || id || 'things';
  return pluralOf(n, q);
};
const nameOfDef = (id) => (id ? (defOf(id)?.name) || CONTENT.expansions.get(id)?.name || String(id).replace(/_/g, ' ') : null);

const plural = (n, one) => `${fmt(n)} ${n === 1 ? one : `${one}s`}`;
/** "a Bakery", "an Apple Tree", "the Old Orchard" stays as named. */
const article = (name) => (/^(the |a |an )/i.test(name) ? name : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`);

const pts10 = (p) => `${Math.floor((p ?? 0) / 10)}.${(p ?? 0) % 10}`;

/**
 * The M1b rows (the weekly and long-term systems, GDD §6.4 "always shown: giant crops, barge rows, Fair medals, Town
 * Projects") as { text, icon, sys? } without the actor, or null for any other kind. Pure; the Journal's history
 * (panels/goals-model.js) uses the same words. sys = the line is the farm's, not a player's.
 */
export function m1bFeedText(row) {
  const q = row.q ?? 0;
  switch (row.k) {
    case 'fair':
      if (row.medal !== undefined) {
        const m = row.medal ? FAIR.medals.find((x) => x.id === row.medal)?.name : null;
        // M2: a league week adds the league move (rules-goals' ceremony row `lg` / `mv`)
        const lg = row.lg ? ` · ${row.mv > 0 ? 'up to' : row.mv < 0 ? 'down to' : 'still in'} the ${FAIR.league?.names?.[row.lg - 1]
          ?? `League ${row.lg}`}` : '';
        return { sys: true, icon: 'ribbon_rosette', text: (m ? `The County Fair: ${m}! +${fmt(row.c ?? 0)} coins for the farm`
          : 'The County Fair judged the week: no medal this time') + lg };
      }
      return { text: `entered ${fmt(q)} ${nameOfItem(row.item, q)} at the Fair (+${pts10(row.p)} points)`, icon: row.item };
    case 'barge':
      if (row.row !== undefined) {
        return { text: `completed barge row ${row.row}: +${fmt(row.c ?? 0)} coins${row.a ? `, ${plural(row.a, 'Acorn')}` : ''}`,
          icon: 'wooden_crate' };
      }
      return { text: `loaded ${fmt(q)} ${nameOfItem(row.item, q)} on the barge (+${fmt(row.c ?? 0)} coins)`, icon: row.item };
    case 'folk': {
      const npc = CONTENT.npcs.get(row.npc);
      return { text: `filled ${npc?.name ? `${npc.name}'s` : 'a neighbour\'s'} request: +${fmt(row.c ?? 0)} coins`, icon: 'order_board' };
    }
    case 'album': {
      const set = CONTENT.collections.get(row.set);
      if (row.done) return { text: `completed the ${set?.name ?? ''} collection!`, glyph: 'star' };
      const it = set?.items.find((i) => i.id === row.item);
      return { text: `found ${it ? article(it.name) : 'a collection piece'} for the album`, icon: row.item, glyph: 'star' };
    }
    case 'giant': return { text: `felled a Giant ${nameOfItem(row.crop, 1)}! (${fmt(q)} ${nameOfItem(row.crop, q)})`, icon: row.crop };
    case 'restore': {
      const p = CONTENT.restoration.get(row.project);
      if (row.done) return { text: `finished restoring the ${p?.name ?? 'old place'}!`, icon: 'hammer' };
      const b = p?.bundles.find((x) => x.id === row.bundle);
      return { text: `tied off the ${b?.name ?? ''} bundle for the ${p?.name ?? 'Restoration'}`, icon: 'hammer' };
    }
    case 'town': {
      const t = CONTENT.townProjects.get(row.id);
      return { sys: true, text: `The village built the ${t?.name ?? 'Town Project'}!`, icon: 'ferry_landing_souvenir' };
    }
    // ---- M2 (rules-goals): the Ribbon Track's season close, the Friendly Duel, Grandma's visit
    case 'track': {
      const season = String(row.s ?? '').split('-')[1] ?? '';
      return { sys: true, glyph: 'ribbon', text: `The ${season ? `${season} ` : ''}Ribbon Track closed at tier ${fmt(row.t ?? 0)}`
        + `${row.c ? `: +${fmt(row.c)} coins for the points left` : ''}` };
    }
    case 'duel':
      if (row.what === 'start') return { text: 'accepted a Friendly Duel!', glyph: 'heart' };
      return { sys: true, glyph: 'heart', text: row.tie ? 'The Friendly Duel ended in a dead heat: two crowns'
        : 'The Friendly Duel is over: a crown for the winner, Hearts for both' };
    case 'grandma':
      return { sys: true, glyph: 'heart', text: row.what === 'left' ? 'Grandma Hazel went home. She left a letter'
        : 'Grandma Hazel is visiting the farm!' };
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

/** A feed ring row as a short sentence. Pure. */
export function feedText(row, state, me) {
  const players = (state && state.players) || {};
  const who = (pid) => (pid === me ? 'You' : (Object.hasOwn(players, pid) ? players[pid].name : 'The farm'));
  const actor = row.by === 'sys' ? 'The farm' : who(row.by);
  const q = row.q ?? 0;
  switch (row.k) {
    case 'harvest': return { actor, text: `harvested ${fmt(q)} ${nameOfItem(row.item, q)}`, icon: row.item };
    case 'tree': return { actor, text: `picked ${fmt(q)} ${nameOfItem(row.item, q)}`, icon: row.item };
    case 'collect': return { actor, text: `collected ${fmt(q)} ${nameOfItem(row.item, q)}`, icon: row.item };
    case 'tend': return { actor, text: `tended ${fmt(q)} animal${q === 1 ? '' : 's'}`, icon: 'feed_scoop' };
    case 'water': return { actor, text: `watered ${fmt(q)} of the crops`, icon: 'watering_can' };
    case 'craft': return { actor, text: `made ${fmt(q)} ${nameOfItem(row.item, q)}`, icon: row.item };
    case 'sell': return { actor, text: `sold ${fmt(q)} ${nameOfItem(row.item, q)} for ${fmt(row.c ?? 0)} coins`, icon: 'coins' };
    case 'order': return { actor, text: `filled ${row.g ? 'a golden order' : 'an order'}: +${fmt(row.c ?? 0)} coins`, icon: 'order_board' };
    case 'level': return { actor: 'The farm', text: `reached level ${row.level}!`, icon: 'xp' };
    case 'buy':
      // a slot is not a building, a Hurry is not a purchase of a thing (rules RC-20 rows carry `what`)
      if (row.what === 'slot') return { actor, text: `added a ${nameOfDef(row.def) ?? 'workshop'} slot${row.c ? ` for ${fmt(row.c)} coins` : ''}`, icon: row.def ?? 'hammer' };
      // a crop finished with "Finish now" is not a batch (live requests 2026-10-04)
      // a "Finish all" batch is one coalesced row with q = plots finished
      if (row.what === 'hurry') return { actor, text: `${row.def === 'plot' ? (row.q > 1 ? `finished ${fmt(row.q)} crops early` : 'finished crops early') : row.q > 1 ? `hurried ${fmt(row.q)} batches` : 'hurried a batch'} for ${plural(row.acorns ?? row.a ?? 0, 'Acorn')}`, icon: 'acorns' };
      return { actor, text: `bought ${article(nameOfDef(row.def) ?? 'something')}${row.c ? ` for ${fmt(row.c)} coins` : ''}${row.a ? ` (${plural(row.a, 'Acorn')})` : ''}`, icon: row.def };
    case 'expand': return { actor, text: `opened new land: ${nameOfDef(row.def)}`, icon: 'hammer' };
    case 'ribbon': return { actor, text: `earned the ${CONTENT.ribbons.get(row.id)?.name ?? 'new'} ribbon`, icon: 'xp' };
    case 'quest': return { actor, text: `finished "${CONTENT.quests.get(row.id)?.title ?? 'a quest'}"`, icon: null };
    case 'keepsake': return { actor, text: `wrapped a keepsake for ${who(row.to)}`, icon: row.item };
    case 'note': return { actor, text: 'pinned a note on the farm', icon: null };
    case 'golden': return { actor: 'Golden Hour!', text: 'everything you start grows faster for a while', icon: 'sunset_bench' };
    case 'hf': return { actor: `${who(row.a)} and ${who(row.b)}`, text: 'high-fived!', icon: null };
    case 'gift': return { actor, text: 'opened the Daily Gift', icon: null };
    case 'chest': return { actor, text: `opened ${row.what === 'meter' ? "Mabel's" : row.what === 'almanac' ? 'the Almanac' : 'a'} chest`, icon: null };
    case 'name': return { actor, text: row.what === 'farm' ? `named the farm "${row.text}"` : `named an animal "${row.text}"`, icon: null };
    case 'wish': {
      const what = nameOfDef(row.def);
      const the = what ? `the ${what}` : 'a wish';
      switch (row.what) {
        case 'deposit': return { actor, text: `put ${fmt(row.c ?? 0)} coins toward ${the}`, icon: row.def ?? 'coins' };
        case 'withdraw': return { actor, text: `took ${fmt(row.c ?? 0)} coins back from ${the}`, icon: row.def ?? 'coins' };
        case 'bought': return { actor: null, text: `${what ? `The ${what}` : 'A wish'} bought itself from the Wishlist!`, icon: row.def ?? 'star' };
        case 'asked': return { actor, text: `asked to use the coins saved for ${the}`, icon: row.def ?? 'coins' };
        case 'denied': return { actor, text: `kept saving for ${the}`, icon: row.def ?? 'heart' };
        default: return { actor, text: what ? `wished for the ${what}` : 'made a wish', icon: row.def ?? 'heart' };
      }
    }
    // wave 4 (the owners' wish list): rows the rules may write for upgrades, weeds and a new look
    case 'upgrade': case 'upgraded':
      return { actor, text: `upgraded the ${nameOfDef(row.def) ?? 'farm'}${row.name ? `: ${row.name}` : ''}`, icon: row.def ?? 'hammer' };
    case 'weed': case 'weeds':
      return { actor, text: `pulled ${q > 1 ? `${fmt(q)} weeds` : 'a weed'} on our land`, icon: 'weed' };
    case 'look': case 'avatar':
      return { actor, text: 'has a new look ✨', icon: null, glyph: 'smile' };
    // wave 4b (owner wishes 2026-10-05): a balloon crate opened (or gone to the Barn by itself), an Acorn treasure
    case 'crate': {
      const bits = [`${fmt(row.c ?? 0)} coins`];
      if (row.a) bits.push(`${fmt(row.a)} Acorn${row.a === 1 ? '' : 's'}`);
      if (row.g) bits.push(`${fmt(row.g)} Golden Seed${row.g === 1 ? '' : 's'}`);
      if (row.item) bits.push(`${row.q > 1 ? `${fmt(row.q)} ` : 'a '}${nameOfItem(row.item, row.q ?? 1)}`);
      if (row.def) bits.push(article(nameOfDef(row.def) ?? 'decor piece'));
      const loot = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}` : bits[0];
      if (row.auto || row.by === 'sys') return { actor: null, text: `A balloon crate nobody opened went to the Barn: ${loot}`, icon: 'coins' };
      return { actor, text: `opened a balloon crate: ${loot}`, icon: row.item ?? 'coins' };
    }
    case 'relic': {
      const rel = typeof CONTENT_ALL.relicOf === 'function' ? CONTENT_ALL.relicOf(row.def) : null;
      const name = rel?.name ?? nameOfDef(row.def) ?? 'a treasure';
      if (row.def === 'farmhand' && row.q !== undefined) return { actor: 'The Farmhand', text: `tended ${fmt(q)} animal${q === 1 ? '' : 's'} for ${actor === 'You' ? 'you' : actor}`, icon: 'feed_scoop' };
      if (row.def === 'time_turner' && row.q !== undefined) return { actor, text: `turned the Time Turner: ${fmt(q)} workshop item${q === 1 ? '' : 's'} done at once`, icon: 'acorns' };
      return { actor, text: `bought the ${name}${row.a ? ` for ${fmt(row.a)} Acorns` : ''}: ours for good ✨`, icon: 'acorns' };
    }
    case 'keep': {
      const you = actor === 'You';
      return { actor, text: row.q ? `${you ? 'keep' : 'keeps'} ${fmt(row.q)} ${nameOfItem(row.item, row.q)} for later` : `stopped keeping ${nameOfItem(row.item, 2)}`, icon: row.item };
    }
    default: {
      const m = m1bFeedText(row);
      if (m) return { actor: m.sys ? null : actor, text: m.text, icon: m.icon ?? null, glyph: m.glyph };
      return { actor, text: row.k ? `did something (${row.k})` : 'did something', icon: null };
    }
  }
}

export function createFeed(S) {
  const { store } = S;
  const list = document.getElementById('feed');
  const local = [];           // { at, by, text, icon, glyph }
  const MAX = FEED.visibleLines || 5;
  const fadeMs = FEED.fadeMs || 8000;
  const thanked = new Set();  // ring indexes this tab already thanked (until the delta lands)

  function canThank(i, row) {
    if (!ACTIONS.thank || row.by === store.pid || row.by === 'sys' || !Object.hasOwn(store.state.players, row.by)) return false;
    return row.ty === undefined && !thanked.has(i);
  }

  function lineEl(l) {
    const li = h('li', { dataset: { key: l.key } });
    patchLine(li, l);
    return li;
  }
  /** Fill (or refill in place) one line: a coalesced ring row grows ("harvested 12" -> "24") without a new <li>. */
  function patchLine(li, { at, by, actor, text, iconId, glyph, thank }) {
    const p = by && store.state && Object.hasOwn(store.state.players, by) ? store.state.players[by] : null;
    const vars = p ? playerVars(p.color) : {};
    li.dataset.at = String(at);
    li.dataset.sig = `${actor}|${text}|${iconId || glyph || ''}|${thank ? 1 : 0}`;
    if (p) { li.style.setProperty('--fc', vars['--pc']); li.style.setProperty('--fcd', vars['--pcd']); li.style.setProperty('--fct', vars['--pct']); li.dataset.slot = by; }
    li.replaceChildren(...[
      iconId ? icon(iconId, { size: 24 }) : glyph ? svgIcon(glyph, 24) : null,
      h('span.txt', p && actor ? playerMark(by, p) : null, p && actor ? ' ' : null, actor ? h('span.actor', actor) : null, actor ? ' ' : null, text),
      thank ? h('button.thanks', {
        type: 'button', 'aria-label': `Thank ${actor}`, 'data-tip': `Say thanks: ${actor} gets a heart`,
        on: { click: (e) => { e.currentTarget.disabled = true; thank(); } },
      }, '♥ Thanks') : null,
    ].filter(Boolean));
  }

  function render() {
    if (!store.state) return;
    const now = store.now();
    // two rows more than shown: a Giant's harvest line folded away still leaves MAX lines
    const rows = foldGiants(feedRows(store.state, MAX + 2), ([, r]) => r, ([i], r) => [i, r]).slice(0, MAX).map(([i, r]) => {
      const t = feedText(r, store.state, store.pid);
      return {
        key: `r${i}`, at: r.at, by: r.by, actor: t.actor, text: t.text, iconId: t.icon, glyph: t.glyph,
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
