// Captain Reed's River Barge (GDD §5.7, M1b; ui-weekly lane, wave 2): the barge docks Monday 06:00 and casts off
// Sunday 20:00. Rows of 3 crates (1-3 rows from last week's play), each crate one item × quantity with what loading
// it pays (1.6 × V × qty coins + XP), who loaded it and the "Need help" flag (at most 3 up); each completed row pays
// E × 0.25 h coins + 1 Acorn + its third of the Captain's chest of the ladder tier; the ladder (tier 1-5) climbs when
// every row of a week is loaded and slips one rung after a week without; the payout preview sums what is left. While
// the jetty is empty the panel shows next week's manifest (frozen at the cast-off) and how the last week went.
// The numbers are the goals lane's own (shared/rules/actions/barge.js: cratePay, rowPay, dockAt, castOffAt).
// Pure readers (`bargeView`, `bargeBadge`) for node tests.
import { BARGE, COOP, itemOf } from '../../../../shared/content/index.js';
import * as BR from '../../../../shared/rules/actions/barge.js';
import { ACTIONS } from '../../../../shared/rules/index.js';
import { systemLive, weekOf } from '../../../../shared/rules/coop.js';
import { h, icon, svgIcon, fmt, playerMark, createKit, fill, price, hintable } from './kit.js';
import { levelOf, available } from './core.js';
import { chest, s as sv } from './art.js';
import { focusOn, actionOf, banner, clockChip, speech, flagButton, lockedBody, splitBar, need, toTop } from './fair.js';

const PER = BARGE.cratesPerRow;

/**
 * A crate's action args: its index plus the barge week and the item it was posted with, whenever the rules take them
 * (RC-07): a load or flag queued offline last Sunday is refused on Monday's new crate instead of loading Butter into
 * it. `v` = bargeView. Pure.
 */
export function crateArgs(type, v, c) {
  const schema = ACTIONS[type]?.schema ?? {};
  const a = { i: c.i };
  if (Object.hasOwn(schema, 'w') && Number.isSafeInteger(v.w)) a.w = v.w;
  if (Object.hasOwn(schema, 'item')) a.item = c.item;
  return a;
}

/** The Captain's chest of ladder tier t: (1 + t) Acorns, 3t Compost, a decor roll from tier 3. */
export function chestOf(t) {
  const c = BARGE.chest;
  return { acorns: c.acornsBase + t, compost: c.compostPerTier * t, decor: t >= c.decorFrom };
}

/**
 * Everything the barge panel draws, DOM-free.
 * @returns {{ live, open, unlock, level, has, docked, arrivesAt, leavesAt, tier, tiers, rows, left, loaded, total,
 *   ready, flags, flagsMax, pay, by, next, log, allDone, streak }}
 */
export function bargeView(state, pid, now) {
  const level = levelOf(state);
  const live = systemLive(BARGE);
  const open = live && level >= BARGE.unlock;
  const b = state.farm.barge ?? null;
  const w = weekOf(state, now);
  const docked = Boolean(b && BR.dockedBarge(state, now));
  const leavesAt = docked ? BR.castOffAt(state, b.w) : BR.castOffAt(state, w);
  const thisDock = BR.dockAt(state, w);
  const arrivesAt = now < thisDock ? thisDock : BR.dockAt(state, w + 1);
  const tier = Math.max(1, Math.min(BARGE.chest.tiers, b?.t ?? 1));
  const rows = [];
  if (docked) {
    const paid = Object.keys(b.paid).length;
    let k = paid;
    for (let r = 0; r < b.rows; r++) {
      const crates = [];
      for (let j = 0; j < PER; j++) {
        const i = r * PER + j;
        const c = b.crates[String(i)];
        if (!c) continue;
        const have = available(state, c.item);
        const loaded = c.by !== null;
        crates.push({ i, row: r, item: c.item, qty: c.qty, by: c.by, at: c.at, flag: c.flag, loaded, have, ready: !loaded && have >= c.qty,
          name: itemOf(c.item)?.name ?? c.item, ...BR.cratePay(state, c, now) });
      }
      const done = Object.hasOwn(b.paid, String(r));
      // the k-th row completed this week takes the k-th share of the chest (the rules split it in whole Acorns)
      const pay = done ? null : BR.rowPay(state, k++);
      rows.push({ i: r, crates, done, pay });
    }
  }
  const all = rows.flatMap((r) => r.crates);
  const left = all.filter((c) => !c.loaded);
  const open2 = rows.filter((r) => !r.done);
  const pay = {
    coins: left.reduce((n, c) => n + c.coins, 0) + open2.reduce((n, r) => n + r.pay.coins, 0),
    xp: left.reduce((n, c) => n + c.xp, 0),
    acorns: open2.reduce((n, r) => n + r.pay.acorns, 0),
    compost: open2.reduce((n, r) => n + r.pay.compost, 0),
    rows: open2.length,
  };
  const by = {};
  for (const c of all) if (c.loaded && c.by) by[c.by] = (by[c.by] ?? 0) + 1;
  const next = !docked && b?.next ? b.next.crates.map((c) => ({ item: c.item, qty: c.qty, name: itemOf(c.item)?.name ?? c.item })) : [];
  return {
    live, open, unlock: BARGE.unlock, level, has: Boolean(b), docked, w: docked ? b.w : null, arrivesAt, leavesAt, tier, streak: b?.streak ?? 0,
    tiers: Array.from({ length: BARGE.chest.tiers }, (_, i) => ({ t: i + 1, ...chestOf(i + 1) })),
    rows, left: left.length, loaded: all.length - left.length, total: all.length, ready: left.filter((c) => c.ready).length,
    flags: left.filter((c) => c.flag).length, flagsMax: BARGE.helpFlags, pay, by, next, nextRows: !docked && b?.next ? b.next.rows : 0,
    log: b?.log ?? null, allDone: rows.length > 0 && rows.every((r) => r.done),
  };
}

/** The barge badge's tone: red on the last day before she casts off, calm before (QA2 UI-03). Pure. */
export function bargeTone(state, pid, now) {
  const v = bargeView(state, pid, now);
  return v.docked && v.leavesAt - now <= 86_400_000 ? null : 'calm';
}

/** The barge's dock badge: crates the barn can load right now (while docked). Pure. */
export function bargeBadge(state, pid, now) {
  const v = bargeView(state, pid, now);
  if (!v.open || !v.docked) return null;
  return v.ready || null;
}

const REED = {
  docked: 'She sits low in the water with room to spare. Load her up before Sunday eight bells, shipmates.',
  done: 'Every hold full! We sail at eight bells on Sunday, with the tide.',
  away: 'The jetty is empty: she is downriver. Monday at six bells she ties up again, steady as she goes.',
  light: 'Nothing on the manifest this week, I\'m afraid. Make a few goods and I\'ll find room aboard, aye.',
};

export const bargePanel = {
  title: 'River Barge',
  icon: 'wooden_crate',
  size: 'full',
  topics: ['barge', 'inventory', 'overflow', 'xp', 'players', 'objects', 'expansions'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const loadType = () => actionOf('bargeLoad');
    const flagType = () => actionOf('bargeFlag');
    const sig = () => {
      const v = bargeView(ctx.store.state, ctx.store.pid, ctx.now());
      const crates = (r) => r.crates.map((c) => [c.item, c.qty, c.by, c.flag, c.have, c.coins]);
      return [v.open, v.has, v.docked, v.w, v.tier, v.rows.map((r) => [r.done, crates(r)]), v.next, v.log];
    };
    const update = kit.memo(body, sig, render);
    ctx.every(60_000, () => update());

    function render() {
      const st = ctx.store.state;
      const now = ctx.now();
      const v = bargeView(st, ctx.store.pid, now);
      if (!v.open) {
        fill(body, lockedBody('f', 'The River Barge', [
          'Captain Reed docks every Monday at 06:00 and casts off on Sunday at 20:00.',
          'He brings rows of crates to fill with goods your farm made lately.',
          'Each crate pays at once; each full row pays extra and a share of the Captain\'s chest.',
        ], v.unlock, v.level, v.live));
        return;
      }
      const chip = v.docked
        ? clockChip(kit, { label: 'Casts off Sunday 20:00 ·', at: v.leavesAt, doneText: 'casting off', glyph: 'crate' })
        : clockChip(kit, { label: 'Docks Monday 06:00 ·', at: v.arrivesAt, doneText: 'docking now', glyph: 'crate', cls: 'closed' });
      const line = !v.docked ? REED.away : !v.rows.length ? REED.light : v.allDone ? REED.done : REED.docked;
      fill(body,
        v.docked
          ? banner('f', 'This week\'s manifest', v.total ? `${v.loaded} of ${v.total} crates loaded · each pays the moment it is aboard`
            : 'Sailing light this week', { chip })
          : banner('f', 'The barge is downriver', 'The jetty is empty until Monday morning', { chip }),
        h('div.wk-barge-top', speech('reed', line), ladder(v)),
        v.docked ? rowsEl(st, v) : awayEl(v),
        v.docked && v.rows.length ? payout(st, v) : null);
      kit.refresh();
      kit.tick();
      if (Number.isInteger(ctx.args.i) && !ctx.wkRang) focusOn(ctx.wkRang = body.querySelector(`[data-crate="${ctx.args.i}"]`));
    }

    function ladder(v) {
      const rungs = v.tiers.map((t) => h(`li.wk-rung-t${t.t === v.tier ? '.on' : ''}${t.t < v.tier ? '.past' : ''}`, {
        title: `Tier ${t.t}: ${t.acorns} Acorns, ${t.compost} Compost${t.decor ? ' and a decor roll' : ''} in the Captain's chest` },
      h('span.wk-rung-n', String(t.t)), chest(30, { gold: t.t >= 4, open: t.t === v.tier }),
      h('small.wk-rung-pay', svgIcon('acorn', 14), String(t.acorns), icon('compost', { size: 16 }), String(t.compost))));
      const up = Math.min(BARGE.chest.tiers, v.tier + 1);
      const rule = v.docked && v.allDone ? `Every row loaded: next week's chest is tier ${up}.`
        : v.tier >= BARGE.chest.tiers ? 'Top of the ladder. Load every row each week to stay here.'
          : `Load every row ${v.docked ? 'this' : 'next'} week to climb to tier ${up}. A week without slips one rung.`;
      return h('section.wk-ladder-barge', { 'aria-label': `The Captain's chest ladder: tier ${v.tier} of ${BARGE.chest.tiers}` },
        h('div.wk-ladder-barge-head', h('b', `The Captain's chest · tier ${v.tier}`), h('small', rule)),
        h('ol.wk-rungs', ...rungs));
    }

    function rowsEl(st, v) {
      if (!v.rows.length) {
        return h('div.wk-empty', svgIcon('crate', 44), h('p', 'No crates on the manifest this week.'),
          h('small', 'The Captain asks for goods the farm made in the last 14 days: one row of three crates for every two '
            + 'hours you played the week before.'));
      }
      return h('div.wk-rows', ...v.rows.map((r) => rowEl(st, v, r)));
    }

    function rowEl(st, v, r) {
      const loadedN = r.crates.filter((c) => c.loaded).length;
      const reward = r.done
        ? h('div.wk-row-pay.paid', svgIcon('check', 26), h('b', 'Row paid!'), h('small', 'coins, Acorns and the chest share are in'))
        : h('div.wk-row-pay',
          h('b', 'A full row pays'),
          price({ coins: r.pay.coins, acorns: r.pay.acorns }),
          h('span.wk-share', chest(24), r.pay.compost ? `+ ${r.pay.compost} Compost` : '+ a chest share',
            r.pay.decorRoll ? h('small', 'and a decor roll') : null),
          h('small', `Acorns include a third of the tier ${v.tier} chest`));
      return h(`section.wk-row${r.done ? '.done' : ''}`, {
        dataset: { row: String(r.i) }, 'aria-label': `Row ${r.i + 1}: ${loadedN} of ${r.crates.length} crates loaded` },
        h('div.wk-row-label', h('span', `Row ${r.i + 1}`), h('small', `${loadedN}/${r.crates.length}`)),
        h('div.wk-crates', ...r.crates.map((c) => crateEl(st, v, c))),
        reward);
    }

    function crateEl(st, v, c) {
      if (c.loaded) {
        const p = c.by ? st.players?.[c.by] : null;
        return h('article.wk-crate.loaded', { dataset: { crate: String(c.i) } },
          h('div.wk-crate-art', icon(c.item, { size: 48 }), h('span.wk-stamp', svgIcon('check', 14), 'Aboard')),
          h('b', `${fmt(c.qty)} × ${c.name}`),
          h('span.wk-crate-by', p ? playerMark(c.by, p) : null, p ? `by ${p.name}` : 'loaded'));
      }
      const args = crateArgs(loadType(), v, c);
      const fargs = crateArgs(flagType(), v, c);
      return h(`article.wk-crate${c.ready ? '.ready' : ''}${c.flag ? '.flagged' : ''}`, { dataset: { crate: String(c.i) } },
        hintable(h('div.wk-crate-art', icon(c.item, { size: 48 }), h('span.wk-qty', `×${fmt(c.qty)}`)), c.item, { need: c.qty }),
        h('b', c.name),
        c.ready ? h('span.wk-have', svgIcon('check', 14), `${fmt(Math.min(c.have, 99_999))} in the barn`)
          : h('span.wk-have', { dataset: { short: 'true' } }, `${fmt(c.have)} of ${fmt(c.qty)} in the barn`),
        h('div.wk-crate-pay', price({ coins: c.coins }), h('span.pn-xp', `+${fmt(c.xp)} XP`)),
        kit.button({ label: 'Load', cls: `btn--small${c.ready ? ' btn--sun' : ' btn--paper'}`, key: `barge:${c.i}`, type: loadType(), args,
          hint: need(c.item, c.qty - c.have), data: { load: String(c.i) } }),
        c.flag && c.flag !== ctx.store.pid && st.players?.[c.flag]
          ? h('span.pn-help-bonus', `Load it for ${st.players[c.flag].name}: +${COOP.helpFlags.xpBonusBp / 100} % XP and a Heart each`) : null,
        c.flag || v.flags < v.flagsMax ? flagButton(ctx, st, c.flag, { type: flagType(), args: fargs }) : null);
    }

    function payout(st, v) {
      const sum = v.left
        ? h('p', h('b', 'Load the rest for'), price({ coins: v.pay.coins, acorns: v.pay.acorns }), h('span.pn-xp', `+${fmt(v.pay.xp)} XP`),
          v.pay.compost ? h('span.wk-plus', icon('compost', { size: 22 }), `${fmt(v.pay.compost)} Compost`) : null)
        : h('p', h('b', 'All aboard!'), ` Every crate is loaded. Next week's chest is tier ${Math.min(BARGE.chest.tiers, v.tier + 1)}.`);
      return h('section.wk-payout', svgIcon('coin', 28), sum,
        splitBar(st, v.by, { format: (n) => `${fmt(n)} crate${n === 1 ? '' : 's'}`, label: 'Crates by farmer' }),
        h('small.wk-muted', 'Unloaded crates simply sail with the barge on Sunday. Nothing is lost.'));
    }

    function awayEl(v) {
      const lg = v.log;
      const next = v.next.length
        ? h('div.wk-next-goods', h('b', 'Next week\'s manifest'),
          h('div.wk-next-row', ...v.next.map((c) => hintable(h('span.wk-next-item', icon(c.item, { size: 40 }), h('span', `${fmt(c.qty)} × ${c.name}`)), c.item, { need: c.qty }))),
          h('small', 'Start making them now: the Captain takes them from Monday 06:00.'))
        : h('p.wk-away-note', v.has && lg ? 'Nothing the farm made lately fits a crate yet. Make a few workshop goods, fruit or '
          + 'slow animal goods this week and the Captain finds room.'
          : 'Next week\'s goods are written down when the barge casts off.');
      return h('div.wk-away', jettyArt(),
        h('div.wk-away-text',
          lg ? h('p.wk-away-log', lg.rows ? `Last week ${lg.done} of ${lg.rows} row${lg.rows === 1 ? '' : 's'} sailed full. `
            + `The Captain's chest is tier ${lg.t} now.` : 'Last week the barge sailed light.') : null,
          next));
    }

    update(true);
    if (!ctx.args.item && !Number.isInteger(ctx.args.i)) requestAnimationFrame(() => toTop(ctx));
    return { update: () => update() };
  },
};

const grad = (id, a, b) => sv('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
  sv('stop', { offset: '0', 'stop-color': a }), sv('stop', { offset: '1', 'stop-color': b }));
const lines = (d, stroke, opacity) => sv('path', { d, stroke, 'stroke-opacity': opacity, 'stroke-width': 2.5, 'stroke-linecap': 'round' });

/** The empty jetty at dusk with the barge far downriver (the panel's "away" scene; wide 1000 x 160 composition). */
export function jettyArt() {
  const ink = '#3E2612';
  const L = (o) => ({ stroke: ink, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...o });
  const svg = sv('svg', { viewBox: '0 0 1000 160', class: 'wk-jetty', role: 'img',
    'aria-label': 'The empty jetty; the barge is far downriver',
    preserveAspectRatio: 'xMidYMax slice' });
  const willow = (x, y, k) => sv('g', {},
    sv('rect', { x: x - 2, y: y - 4, width: 4, height: 16 * k, fill: '#7A4E2A' }),
    sv('path', { d: `M${x - 22 * k} ${y + 8 * k} q${2 * k} -${30 * k} ${22 * k} -${30 * k} q${20 * k} 0 ${22 * k} ${30 * k} `
      + `q-${6 * k} -${10 * k} -${10 * k} -${4 * k} q-${6 * k} -${8 * k} -${12 * k} 0 q-${6 * k} -${8 * k} -${12 * k} ${4 * k} z`,
      fill: '#6FA84A', stroke: '#4C7F33', 'stroke-width': 1.4 }));
  svg.append(
    sv('defs', {},
      grad('wk-dusk', '#FFD3A0', '#FFF0D6'), grad('wk-water', '#86C9EC', '#3E8FC4')),
    sv('rect', { x: 0, y: 0, width: 1000, height: 160, fill: 'url(#wk-dusk)' }),
    sv('circle', { cx: 760, cy: 58, r: 20, fill: '#FFE58A', opacity: 0.95 }),
    sv('path', { d: 'M0 84 q120 -30 260 -12 t280 -8 t240 6 t220 -12 V104 H0 z', fill: '#B5CF8E' }),
    sv('path', { d: 'M0 94 q160 -14 340 -4 t360 -6 t300 4 V108 H0 z', fill: '#8DB865' }),
    willow(70, 82, 1), willow(128, 88, 0.7), willow(880, 84, 1.05), willow(936, 90, 0.75), willow(520, 92, 0.55),
    sv('rect', { x: 0, y: 102, width: 1000, height: 58, fill: 'url(#wk-water)' }),
    lines('M760 108 h18 M748 114 h40 M756 120 h26', '#FFE58A', 0.7),
    sv('g', { class: 'wk-far-barge' },
      sv('path', L({ d: 'M640 106 h52 l-6 8 h-40 z', fill: '#8A5224', 'stroke-width': 1.4 })),
      sv('rect', { x: 652, y: 97, width: 15, height: 9, fill: '#C9A36A', stroke: ink, 'stroke-width': 1.2 }),
      sv('rect', { x: 671, y: 100, width: 8, height: 6, fill: '#B07A43', stroke: ink, 'stroke-width': 1 }),
      sv('path', { d: 'M640 106 q-14 -4 -26 0', fill: 'none', stroke: '#FFFFFF', 'stroke-opacity': 0.7, 'stroke-width': 1.6 })),
    lines('M420 124 h70 M560 140 h90 M840 128 h60 M300 146 h70', '#FFFFFF', 0.5),
    sv('path', L({ d: 'M-10 126 L330 136 L330 150 L-10 146 z', fill: '#B07A43' })),
    sv('path', { d: 'M40 128 v18 M90 129 v18 M140 131 v17 M190 132 v17 M240 134 v15 M290 135 v15', stroke: '#8A5224',
      'stroke-width': 1.8 }),
    sv('rect', L({ x: 160, y: 116, width: 10, height: 44, rx: 2, fill: '#8A5224' })),
    sv('rect', L({ x: 318, y: 118, width: 10, height: 42, rx: 2, fill: '#8A5224' })),
    sv('path', L({ d: 'M170 122 q74 16 148 2', fill: 'none', stroke: '#C9A36A', 'stroke-width': 2.6 })),
    sv('path', L({ d: 'M323 118 v-36 h18', fill: 'none' })),
    sv('rect', L({ x: 336, y: 82, width: 12, height: 15, rx: 2, fill: '#FFD76A', 'stroke-width': 1.6 })),
    sv('circle', { cx: 342, cy: 90, r: 14, fill: '#FFD76A', opacity: 0.25 }),
  );
  return svg;
}
