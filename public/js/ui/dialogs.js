// Dialogs (ui-shell lane): the "are you sure?" card for soft codes (BIG_SPEND, RESERVED, PINNED; GDD §6.3) and a
// generic confirm. Built as registry panels of size 'card' (wood frame, scrim, focus trap, Esc = no), stacked on top
// of whatever panel asked.
//
//   confirm({ title, lead, body?, icon?, cost?: { coins?, acorns? }, ok?, cancel?, okKind?, fine? }) -> Promise<bool>
//   softConfirm(code, { type, args })   the controller's local refusal with a SOFT code: explain, then re-send the
//                                        same action with args.confirm += [code] on "yes" (prediction as usual)
//   dryCost(state, type, args, pid, now) -> { coins, acorns } | null   what an action would spend (a dry run on a
//                                        clone with the soft code confirmed); used to show the real price
import { runAction, makeCtx } from '../../../shared/rules/index.js';
import { keptOf, acornsToday } from '../../../shared/rules/economy.js';
import { inputsFor, recipeDef, FEED_VALUABLE_MUL } from '../../../shared/rules/actions/crafting.js';
import { CONTENT, defOf, itemOf, SAFETY, pluralOf } from '../../../shared/content/index.js';
import { ERR } from '../../../shared/net/protocol.js';
import { h, icon, svgIcon, fmt } from './dom.js';

/** Coins and Acorns an action would spend, from a dry run on a deep clone (null when it cannot run). */
export function dryCost(state, type, args, pid, now) {
  try {
    const clone = structuredClone(state);
    const confirm = [...new Set([...(args.confirm || []), ERR.BIG_SPEND, ERR.RESERVED, ERR.PINNED])];
    const ctx = makeCtx(clone, { now, pid, cid: 'dryrun', seq: 1 });
    const r = runAction(clone, { type, args: { ...args, confirm } }, ctx);
    if (!r || !r.ok) return null;
    return {
      coins: Math.max(0, state.farm.wallet.coins - clone.farm.wallet.coins),
      acorns: Math.max(0, state.farm.wallet.acorns - clone.farm.wallet.acorns),
    };
  } catch {
    return null;
  }
}

/**
 * The partner's heads-up for a big purchase (GDD §6.3 BIG_SPEND: above 25 % of the treasury AND above 1,000 coins,
 * or >= 10 Acorns), from a purchase event the state already reflects. Pure; null when the purchase is not big.
 */
export function partnerHeadsUp(ev, state, who) {
  const coins = ev.coins || 0;
  const acorns = ev.acorns || 0;
  const before = state.farm.wallet.coins + coins;
  const big = (coins > SAFETY.bigSpend.minCoins && coins * 10000 > before * SAFETY.bigSpend.shareBp) || acorns >= SAFETY.bigSpend.acorns;
  if (!big) return null;
  const what = ev.def ? (defOf(ev.def)?.name ?? ev.def)
    : ev.expansion ? (CONTENT.expansions.get(ev.expansion)?.name ?? 'new land')
      : ev.tool ? (CONTENT.tools.get(ev.tool)?.name ?? 'a tool') : 'a Barn upgrade';
  return `${who} is buying ${what} — ${coins ? `${fmt(coins)} coins` : `${fmt(acorns)} acorns`}`;
}

/** What a thing the action names is called ("a Pie Oven", "Eggs"). */
function subjectOf(args) {
  if (!args) return null;
  const d = args.def ? defOf(args.def) : null;
  if (d) return { name: d.name || args.def, icon: args.def };
  const it = args.item ? itemOf(args.item) : null;
  if (it) return { name: it.name || args.item, icon: args.item };
  return null;
}

/** The friendly copy for a soft code (pure: tests read it). */
export function softCopy(code, { state, pid, args, cost, now = 0 }) {
  const subj = subjectOf(args);
  const players = state ? state.players : {};
  const nameOf = (p) => (p && Object.hasOwn(players, p) ? (p === pid ? 'You' : players[p].name) : 'Your partner');
  if (code === ERR.BIG_SPEND) {
    const coins = cost && cost.coins;
    const acorns = cost && cost.acorns;
    const share = coins && state ? Math.round((coins / Math.max(1, state.farm.wallet.coins)) * 100) : null;
    const B = SAFETY.bigSpend;
    const partner = state ? Object.keys(state.players).filter((p) => p !== pid).map((p) => state.players[p].name)[0] : null;
    // the per-player daily Acorn line: several small Acorn buys add up to a heads-up too (rules isBigSpend)
    let today = 0;
    try { today = state && acorns > 0 && acorns < B.acorns ? acornsToday(state, pid, now) : 0; } catch { today = 0; }
    return {
      title: 'A big purchase',
      lead: subj ? `Buy ${subj.name}?` : 'Spend this much?',
      body: acorns >= B.acorns
        ? `That is ${fmt(acorns)} Acorns from the farm's shared stash.`
        : acorns > 0 && today + acorns >= B.acornsPerPlayerDay
          ? `That makes ${fmt(today + acorns)} Acorns you spent today (${partner ?? 'your partner'} gets a heads-up from ${fmt(B.acornsPerPlayerDay)}).`
          : share !== null && share > 0
            ? `That is about ${Math.min(100, share)} % of the farm treasury you share.`
            : 'This spends a big part of the farm treasury you share.',
      fine: 'Your partner gets a friendly heads-up. Undo works for 10 minutes while it is untouched.',
      ok: 'Buy it', okKind: 'go', icon: subj ? subj.icon : 'coins', cost,
    };
  }
  if (code === ERR.RESERVED) {
    const feed = feedAsk(state, args);
    if (feed) return feed;
    const k = state && args && args.item ? keptOf(state, args.item) : { n: 0, by: null };
    const item = subj ? subj.name : 'these';
    return {
      title: 'Kept for later',
      lead: k.n ? `${nameOf(k.by)} ${k.by === pid ? 'keep' : 'keeps'} ${fmt(k.n)} ${subj ? pluralOf(subj.name, k.n) : item}.` : `Some ${subj ? pluralOf(item, 2) : item} are kept for later.`,
      body: 'Use them anyway? The barn will go below the kept amount.',
      ok: 'Use anyway', okKind: 'sun', icon: subj ? subj.icon : 'barn',
    };
  }
  if (code === ERR.PINNED) {
    return {
      title: 'Pinned',
      lead: 'Your partner pinned this.',
      body: 'Change it anyway? They will see a note and can put it back.',
      ok: 'Change it', okKind: 'sun', icon: subj ? subj.icon : null,
    };
  }
  if (code === 'PRICE') {
    // the partner bought one a moment ago: the next copy costs more than the price that was on screen (RC-18)
    const now = cost && cost.coins ? `${fmt(cost.coins)} coins` : 'a little more';
    return {
      title: 'The price went up',
      lead: subj ? `${partnerOf(state, pid)} just bought one. The next ${subj.name} is ${now}.` : `The next one is ${now}.`,
      body: 'Buy it at the new price?', ok: 'Buy it', okKind: 'go', icon: subj ? subj.icon : 'coins', cost,
    };
  }
  return { title: 'Are you sure?', lead: 'Go ahead?', ok: 'Yes', okKind: 'go' };
}

/**
 * A feed's RESERVED (wave-1 QA RC-17): only class members worth more than FEED_VALUABLE_MUL x the feed are left, so the
 * Feed Mill asks before it burns them. Names what a confirmed Make takes, from the rules' own walk. Null for anything
 * else (a recipe, a sale: the Keep N copy below).
 */
function feedAsk(state, args) {
  const r = state && args && typeof args.recipe === 'string' ? recipeDef(args.recipe) : null;
  if (!r || r.inputs || !Array.isArray(r.classes)) return null;
  const take = inputsFor(state, r, { valuable: true });
  if (!take) return null;
  const items = Object.keys(take).sort();
  const words = items.map((id) => `${fmt(take[id])} ${pluralOf(itemOf(id)?.name ?? id, take[id])}`);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
  const dear = items.filter((id) => (itemOf(id)?.sell ?? 0) > FEED_VALUABLE_MUL * (r.sell ?? 0))
    .sort((a, b) => (itemOf(b)?.sell ?? 0) - (itemOf(a)?.sell ?? 0));
  const top = dear[0] ? itemOf(dear[0]) : null;
  return {
    title: 'Worth a lot',
    lead: `Use ${list} for ${r.name}?`,
    body: top ? `${pluralOf(top.name, 2)} sell for ${fmt(top.sell)} coins each; ${r.name} is worth ${fmt(r.sell ?? 0)}. `
      + 'The Feed Mill never uses them without asking.' : 'The Feed Mill never uses these without asking.',
    ok: 'Use anyway', okKind: 'sun', icon: top ? top.id : r.id,
  };
}

function partnerOf(state, pid) {
  const other = state ? Object.keys(state.players).find((p) => p !== pid) : null;
  return other ? state.players[other].name : 'Your partner';
}

export function createDialogs(S) {
  const { ui } = S;
  let pending = null;     // { resolve, opts }

  function settle(v) {
    const p = pending;
    pending = null;
    if (p) p.resolve(v);
  }

  ui.panels.register('confirm', {
    title: (a) => a.title || 'Are you sure?',
    size: 'card',
    modal: true,
    mount(body, ctx) {
      const o = (pending && pending.opts) || ctx.args;
      const yes = h(`button.btn${o.okKind && o.okKind !== 'go' ? `.btn--${o.okKind}` : ''}`, {
        type: 'button', on: { click: () => { settle(true); ctx.close(); } },
      }, o.ok || 'Yes');
      const no = h('button.btn.btn--paper', { type: 'button', on: { click: () => { settle(false); ctx.close(); } } }, o.cancel || 'Not now');
      const costRow = o.cost && (o.cost.coins || o.cost.acorns)
        ? h('div.cost', o.cost.coins ? [icon('coins', { size: 30 }), fmt(o.cost.coins)] : null,
          o.cost.acorns ? [icon('acorns', { size: 30 }), fmt(o.cost.acorns)] : null)
        : null;
      body.append(h('div.dlg',
        o.icon ? icon(o.icon, { size: 92, cls: 'art' }) : svgIcon(o.glyph || 'star', 92),
        o.lead ? h('p.lead', o.lead) : null,
        costRow,
        o.body ? h('p.body', o.body) : null,
        h('div.acts', no, yes),
        o.fine ? h('p.fine', o.fine) : null));
      // the safe choice gets focus: Enter on a stray keypress never spends the treasury
      setTimeout(() => no.focus({ preventScroll: true }), 30);
    },
    onClose() { settle(false); },
  });

  function confirm(opts = {}) {
    settle(false);
    return new Promise((resolve) => {
      pending = { resolve, opts };
      const args = { title: opts.title || 'Are you sure?' };
      if (!ui.panels.open('confirm', args, { stack: true })) settle(false);
    });
  }

  async function softConfirm(code, { type, args = {} } = {}) {
    const state = S.store.state;
    // a price that went up (RC-18) is quoted without the old ceiling and re-sent with the new one
    const { max: _seen, ...free } = args;
    const cost = code === ERR.BIG_SPEND ? dryCost(state, type, args, S.store.pid, S.store.now())
      : code === 'PRICE' ? dryCost(state, type, free, S.store.pid, S.store.now()) : null;
    const copy = softCopy(code, { state, pid: S.store.pid, args, cost, now: S.store.now() });
    const ok = await confirm(copy);
    if (!ok) return null;
    if (code === 'PRICE') return S.controller.do(type, cost && cost.coins ? { ...free, max: cost.coins } : free);
    const confirmList = [...new Set([...(args.confirm || []), code])];
    return S.controller.do(type, { ...args, confirm: confirmList });
  }

  return { confirm, softConfirm };
}
