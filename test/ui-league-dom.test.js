// ui-league lane (wave 3): the lane's panels mounted in the ui tests' tiny DOM (test/ui-qa2-dom.js) on farms built by
// the real rules: each one draws its open and its locked state without junk text, and every button sends exactly the
// action and args the rules take. Also the lane's install: its eight panels, the one "Progress" dock button and the
// duel's live score chip in the HUD.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, textOf } from './ui-qa2-dom.js';
import { CONTENT, featureOf } from '../shared/content/index.js';
import { forceLiveForTests } from '../shared/rules/coop.js';
import { farmAt, put, give, runDue, actOk, forceM2Goals, MONDAY, HOUR, DAY } from './helpers/rules-goals.js';

installDom();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

let P;
before(async () => {
  await forceM2Goals();
  forceLiveForTests(['friendly_duel', 'rested_xp'].map((id) => featureOf(id)).filter(Boolean));
  P = {
    league: await import('../public/js/ui/panels/league.js'),
    show: await import('../public/js/ui/panels/horseshow.js'),
    track: await import('../public/js/ui/panels/season-track.js'),
    perks: await import('../public/js/ui/panels/perks.js'),
    legacy: await import('../public/js/ui/panels/legacy.js'),
    duel: await import('../public/js/ui/panels/duel.js'),
  };
});

const JUNK = /undefined|NaN|\[object|null\b/;

/** A panel ctx over a plain state (what the shell hands a panel), recording what the panel asks for. */
function ctxOf(state, { pid = 'p1', now = MONDAY + HOUR, name = 'x', args = {}, answer = true } = {}) {
  const acts = [];
  const opened = [];
  const asked = [];
  const body = document.createElement('div');
  const store = { state, pid, now: () => now, on: () => () => {}, act: (t, a) => { acts.push([t, a]); return { ok: true }; } };
  const ctx = {
    name, args, store, body, el: body, now: () => now, tab: null,
    every: () => () => {}, on: () => () => {}, subscribe: () => () => {},
    act: (t, a) => { acts.push([t, a]); return { ok: true }; },
    close: () => opened.push(['close']), setTitle: (t) => { ctx.title = t; }, refreshTabs() {},
    ui: { panels: { open: (n, a) => { opened.push([n, a]); return true; }, has: () => true, isOpen: () => false, badge() {}, on: () => () => {} },
      // the shell's "are you sure?" card (wave 4: learning a perk asks first)
      confirm: (o) => { asked.push(o); return Promise.resolve(answer); }, toast() {} },
  };
  return { ctx, body, acts, opened, asked };
}

function mount(spec, state, o = {}) {
  const r = ctxOf(state, o);
  spec.mount(r.body, r.ctx);
  const text = textOf(r.body);
  assert.ok(!JUNK.test(text), `junk in ${o.name}: ${text.match(/.{0,40}(undefined|NaN|\[object|null\b).{0,40}/)?.[0]}`);
  return { ...r, text };
}

const buttons = (el, label) => el.querySelectorAll('button').filter((b) => textOf(b).startsWith(label));

/** An L33 farm with this week's league Fair, a Stable with a ribboned horse, the track a few tiers in. */
function farm33() {
  const s = farmAt(33);
  s.farm.name = 'Willow Bend';
  s.players.p1.xp = CONTENT.levels[27].personalXp;
  s.players.p2.xp = CONTENT.levels[25].personalXp;
  runDue(s, MONDAY);
  const stable = put(s, 'stable');
  put(s, 'horse', { home: stable, cycle: 22 });
  give(s, 'show_ribbon', 2);
  s.farm.track.xp = s.farm.track.need * 3 + 10;
  return s;
}

test('league panel: the table, the five leagues, Platinum waiting for its project; Enter goods opens the Fair', () => {
  const s = farm33();
  const { body, text, opened } = mount(P.league.leaguePanel, s, { name: 'league' });
  assert.match(text, /The Hedgerow League/);
  assert.match(text, /Brambleton/);
  assert.match(text, /Willow Bend/);
  assert.match(text, /Five leagues/);
  assert.match(text, /Platinum waits for the Town Fair Grounds/);
  assert.equal(body.querySelectorAll('.lg-row').length, 6);
  assert.equal(body.querySelectorAll('.lg-row.us').length, 1);
  buttons(body, 'Enter goods at the Fair')[0].click();
  assert.deepEqual(opened.at(-1), ['fair', undefined]);
  buttons(body, 'See the Ledger')[0].click();
  assert.deepEqual(opened.at(-1), ['restoration', { id: 'fair_grounds' }]);
  const locked = mount(P.league.leaguePanel, farmAt(20), { name: 'league' });
  assert.match(locked.text, /Opens at farm level 27/);
  // the league reached after this week's Fair opened (no league week yet): the table waits for Monday, no junk
  const late = farmAt(26);
  runDue(late, MONDAY);
  late.farm.xp = farm33().farm.xp;
  const wait = mount(P.league.leaguePanel, late, { name: 'league' });
  assert.match(wait.text, /Your first league week starts on Monday/);
});

test('league result card: up a league after the real ceremony', () => {
  const s = farm33();
  s.farm.fair.cur.p = s.farm.fair.cur.W * 30;                // far above every NPC final
  runDue(s, MONDAY + 6 * DAY + 11 * HOUR);
  const { text } = mount(P.league.leagueResultPanel, s, { name: 'leagueResult', now: MONDAY + 7 * DAY });
  assert.match(text, /Up to the Meadow League!/);
  assert.match(text, /1st in the Hedgerow League/);
  assert.match(text, /The league paid/);
});

test('horse show panel: the ring, the ribboned horse; Enter sends the Fair entry of Show Ribbons', () => {
  const s = farm33();
  const { body, text, acts } = mount(P.show.horseShowPanel, s, { name: 'horseShow' });
  assert.match(text, /Show Ribbons/);
  assert.match(text, /2 in the barn/);
  assert.match(text, /Blue ribbon/);
  buttons(body, 'Enter 2')[0].click();
  assert.deepEqual(acts.at(-1), ['fairEnter', { item: 'show_ribbon', qty: 2 }]);
  const locked = mount(P.show.horseShowPanel, farmAt(20), { name: 'horseShow' });
  assert.match(locked.text, /Opens at farm level 25/);
});

test('track panel: 30 tiers, the claimable ones claim themselves by tier, Claim all sends one per tier', () => {
  const s = farm33();
  const { body, text, acts } = mount(P.track.seasonTrackPanel, s, { name: 'seasonTrack' });
  assert.match(text, /Tier 3 of 30/);
  assert.match(text, /The Autumn Ribbon Track/);
  assert.equal(body.querySelectorAll('.lg-tier').length, 30);
  assert.equal(body.querySelectorAll('.lg-tier.claim').length, 3);
  buttons(body, 'Claim all 3')[0].click();
  assert.deepEqual(acts.map((a) => a[1].tier), [1, 2, 3]);
  assert.ok(acts.every((a) => a[0] === 'trackClaim'));
  const one = buttons(body, 'Claim').filter((b) => textOf(b) === 'Claim');
  one[0].click();
  assert.deepEqual(acts.at(-1), ['trackClaim', { tier: 1 }]);
  const locked = mount(P.track.seasonTrackPanel, farmAt(20), { name: 'seasonTrack' });
  assert.match(locked.text, /Opens at farm level 24/);
});

test('perks panel: points, four trees, Learn asks first, then sends the tree; the partner\'s choices are shown, never changed', async () => {
  const s = farm33();
  actOk(s, 'perkPick', { tree: 'rancher' }, { pid: 'p2', now: MONDAY });
  const { body, text, acts, asked } = mount(P.perks.perksPanel, s, { name: 'perks' });
  assert.match(text, /points to spend/);
  for (const t of ['Grower', 'Rancher', 'Orchardist', 'Artisan']) assert.match(text, new RegExp(t));
  assert.match(text, /Mia's perks: Rancher 1|perks: Rancher 1/);
  const learn = buttons(body, 'Learn');
  assert.equal(learn.length, 4, 'one Learn per tree: the next perk only');
  learn[2].click();
  assert.equal(acts.length, 0, 'a click alone never spends a point (wave 4, wish G: the misclick guard)');
  await new Promise((r) => setTimeout(r, 0));
  assert.match(asked.at(-1).title, /^Learn .+\?$/);
  assert.equal(asked.at(-1).ok, 'Learn it');
  assert.deepEqual(acts.at(-1), ['perkPick', { tree: 'orchardist' }]);
  // "Not now" sends nothing
  const no = mount(P.perks.perksPanel, s, { name: 'perks', answer: false });
  buttons(no.body, 'Learn')[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(no.asked.length, 1);
  assert.equal(no.acts.length, 0);
  const locked = mount(P.perks.perksPanel, farmAt(5), { name: 'perks' });
  assert.match(locked.text, /Opens at farm level 12/);
});

test('legacy panel: before 40 it shows the way there; after, the Legacy level and what comes next', () => {
  const pre = mount(P.legacy.legacyPanel, farmAt(33), { name: 'legacy' });
  assert.match(pre.text, /Legacy levels start after level 40/);
  assert.match(pre.text, /What Legacy levels pay/);
  const post = mount(P.legacy.legacyPanel, farmAt(42), { name: 'legacy' });
  assert.match(post.text, /Legacy 2:/);
  assert.match(post.text, /L43/);
});

test('duel panel: pick a duel, invite; the invited farmer accepts or declines; the live board on both sides', () => {
  const s = farm33();
  const a = mount(P.duel.duelPanel, s, { name: 'duel' });
  assert.match(a.text, /Challenge Mia/);
  const invite = buttons(a.body, 'Invite Mia')[0];
  invite.click();
  assert.equal(a.acts.length, 0, 'nothing is sent before a duel is picked');
  a.body.querySelector('[data-kind="pies"]').click();
  buttons(a.body, 'Invite Mia')[0].click();
  assert.deepEqual(a.acts.at(-1), ['duelInvite', { kind: 'pies' }]);
  actOk(s, 'duelInvite', { kind: 'pies' }, { pid: 'p1', now: MONDAY + HOUR });
  const b = mount(P.duel.duelPanel, s, { name: 'duel', pid: 'p2' });
  assert.match(b.text, /challenges you/);
  buttons(b.body, 'Not this week')[0].click();
  assert.deepEqual(b.acts.at(-1), ['duelDecline', {}]);
  buttons(b.body, 'Accept')[0].click();
  assert.deepEqual(b.acts.at(-1), ['duelAccept', {}]);
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + HOUR });
  s.farm.duel.cur.s = { p1: 3, p2: 5 };
  const live = mount(P.duel.duelPanel, s, { name: 'duel', now: MONDAY + 2 * HOUR });
  assert.match(live.text, /3/);
  assert.match(live.text, /vs/);
  assert.equal(live.body.querySelectorAll('.lg-duel-side.lead').length, 1);
  const solo = mount(P.duel.duelPanel, farmAt(33, { players: ['p1'] }), { name: 'duel' });
  assert.match(solo.text, /A duel needs two farmers/);
  assert.doesNotMatch(solo.text, /Coming soon|Opens at farm level/);
});

test('duel result card: the winner, the scores, the Hearts', () => {
  const s = farm33();
  actOk(s, 'duelInvite', { kind: 'pies' }, { pid: 'p1', now: MONDAY + HOUR });
  actOk(s, 'duelAccept', {}, { pid: 'p2', now: MONDAY + HOUR });
  s.farm.duel.cur.s = { p1: 9, p2: 5 };
  runDue(s, MONDAY + 6 * DAY + 11 * HOUR);
  const { text } = mount(P.duel.duelResultPanel, s, { name: 'duelResult', now: MONDAY + 7 * DAY });
  assert.match(text, /You win the crown!/);
  assert.match(text, /9 to 5/);
  assert.match(text, /Hearts each/);
});

test('install: eight panels, ONE Progress dock button on the first open panel, the duel chip in the HUD on both sides', async (t) => {
  const s = farm33();
  actOk(s, 'duelInvite', { kind: 'orders' }, { pid: 'p2', now: MONDAY + HOUR });
  const hud = document.createElement('div');
  hud.setAttribute('id', 'hud');
  document.body.append(hud);
  const reg = new Map();
  const badges = new Map();
  const ui = { panels: { register: (n, spec) => { reg.set(n, spec); return () => reg.delete(n); }, badge: (n, v, tone) => badges.set(n, [v, tone]),
    on: () => () => {}, has: (n) => reg.has(n), isOpen: () => false, open: () => true } };
  const store = { state: s, pid: 'p1', now: () => MONDAY + 2 * HOUR, on: () => () => {}, act: () => ({ ok: true }) };
  const off = P.league.installLeague(ui, { store });
  t.after(off);                                           // its timers must not outlive the test
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual([...reg.keys()].sort(), ['duel', 'duelResult', 'horseShow', 'league', 'leagueResult', 'legacy', 'perks', 'seasonTrack']);
  const docks = [...reg.entries()].filter(([, spec]) => spec.dock).map(([n, spec]) => [n, spec.dock.label]);
  assert.deepEqual(docks, [['seasonTrack', 'Progress']]);
  assert.equal(badges.get('seasonTrack')?.[0], '!', 'the invitation waits for p1');
  const chip = hud.querySelector('.lg-duel-chip');
  assert.ok(chip, 'the chip is in the HUD');
  assert.equal(chip.hidden, false);
  assert.match(textOf(chip), /Mia challenges you!/);
  off();
  assert.equal(reg.size, 0);
  assert.equal(hud.querySelector('.lg-duel-chip'), null, 'uninstall removes the chip');
});
