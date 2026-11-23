// Co-op comms corner (GDD §6.2 #2 pings/emotes/notes, #10 high-five; §7.3 bottom-left): the Ping button (G: ping
// at the cursor; the button arms a one-click ping), the emote wheel (T), the Notes button (opens the 'notes' panel
// when ui-panels registers it). Incoming relays arrive through ui.emote(pid, id) / ui.mark(pid, mark) (main.js
// routes MSG.EMOTE / MSG.MARK there). The 3D bubble, marker and off-screen arrow are render-life's
// (view.avatars.emote / ping / highFive); this module sends, captions in the feed and keeps the 1-per-second
// manners. ui-shell lane.
import { EMOTES, MARKS, MSG, LIMITS } from '../../../shared/net/protocol.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { dayOf, goldenHourAllowed } from '../../../shared/rules/coop.js';
import { giftsFor } from '../../../shared/rules/actions/coop.js';
import { h, svgIcon, kv, touchPlayer, touchText } from './dom.js';
import { t, tn, onLang } from '../i18n/index.js';
import { lazyImport } from '../net/lazy.js';

/** Protocol emote id -> [emoji, label, render-life bubble kind, feed verb]. Label and verb are read in the language in
 *  effect (catalog 'social.emote.<id>' / '.did'). */
const emoteRow = (id, emoji, kind) => {
  const row = [emoji, undefined, kind, undefined];
  Object.defineProperty(row, 1, { get: () => t(`social.emote.${id}`), enumerable: true });
  Object.defineProperty(row, 3, { get: () => t(`social.emote.${id}.did`), enumerable: true });
  return Object.freeze(row);
};
export const EMOTE_INFO = Object.freeze({
  wave: emoteRow('wave', '👋', 'wave'),
  heart: emoteRow('heart', '💖', 'heart'),
  laugh: emoteRow('laugh', '😄', 'laugh'),
  thumbs_up: emoteRow('thumbs_up', '👍', 'thumbs'),
  come_here: emoteRow('come_here', '🙋', 'come'),
  cheer: emoteRow('cheer', '🎉', 'star'),
  high_five: emoteRow('high_five', '✋', null),
  dance: emoteRow('dance', '💃', 'wow'),
});

const PING_GAP_MS = 1000;

/**
 * Would my sitting down now be good for something (QA r3 S3-22, coop#6: "{name} is waiting on the bench · Join" under a
 * Golden Hour that was already running, and sitting again started nothing)? Not while a Golden Hour runs; then a Golden
 * Hour that may start (its session gap passed), or today's bench for the together quests not counted yet with my seat
 * missing (rules progress.js: farm.coop.days). Pure.
 */
export function benchUseful(state, pid, now) {
  const co = state?.farm?.coop ?? {};
  const g = co.golden;
  if (g && now >= g.from && now < g.until) return false;
  if (goldenHourAllowed(state, now)) return true;
  const days = co.days;
  if (!days || days.d !== dayOf(state, now)) return true;            // a new farm day: the bench counts afresh
  return !days.done?.bench && !days.sat?.[pid];
}

export function createSocial(S) {
  const { store, view, controller, ui } = S;
  const box = document.getElementById('social');
  const canvas = document.getElementById('world');
  let hover = null;                 // the controller's last hover pick (float tiles px/pz)
  let lastPing = 0;
  let lastEmote = 0;
  let armed = false;
  let wheel = null;

  const send = (m) => {
    if (typeof controller.send === 'function') return controller.send(m);
    const net = globalThis.__hh && globalThis.__hh.net;
    return net && typeof net.raw === 'function' ? net.raw(m) : undefined;
  };
  const avatars = () => (view && view.avatars) || null;
  const nameOf = (pid) => (pid === store.pid ? t('common.you') : store.state?.players?.[pid]?.name ?? t('common.partner'));

  controller.on('hover', (p) => { hover = p; });

  // ---- buttons ---------------------------------------------------------------------------------------------
  // data-label is the phone's caption under each button (css/mobile.css content: attr(data-label))
  const pingBtn = h('button.social-btn', { type: 'button', 'aria-pressed': 'false', on: { click: () => arm(!armed) } },
    svgIcon('ping', 32), h('span.key', { 'aria-hidden': 'true' }, 'G'));
  const emoteBtn = h('button.social-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', on: { click: () => toggleWheel(emoteBtn) } },
    svgIcon('smile', 32), h('span.key', { 'aria-hidden': 'true' }, 'T'));
  const notesBtn = h('button.social-btn', {
    type: 'button', on: { click: () => (ui.panels.has('notes') ? ui.panels.toggle('notes') : ui.toast(t('social.notesSoon'), { kind: 'info' })) },
  }, svgIcon('note', 32));
  const chatBtn = h('button.social-btn', { type: 'button', 'aria-expanded': 'false', on: { click: () => toggleChat() } }, svgIcon('chat', 30));
  // M21 (features#F1): "Leave a surprise" for the partner: features' gift sheet (ui/panels/gift.js openGiftSheet)
  const giftBtn = h('button.social-btn.gift-btn', { type: 'button', dataset: { gift: 'open' }, on: { click: () => openGift() } },
    h('span.gift-ico', { 'aria-hidden': 'true' }, '🎁'));
  function openGift() {
    // the Together button takes the focus before the sheet opens, so the sheet records it as its opener and gives the
    // focus back to it on Escape, Wrap and Open (QA r3 S3-C1, ap#1: closing the menu hid the focused button, the focus
    // fell to <body> and the sheet had no opener). In the phone's Farm book the book's own button takes it (S2-14)
    closeTogether({ focus: !inBook() });
    // a surprise waits for me: the camera shows the box on the porch, the sheet offers "Open it" (QA r3 S3-C2)
    const box = waitingBox();
    if (box && typeof view?.focus === 'function') view.focus(box.x + 0.5, box.z + 0.5);
    lazyImport('gift', () => import('./panels/gift.js')).then((m) => m.openGiftSheet(ui), () => ui.panels.open('gift'));
  }
  /** The first box on the farm waiting for me to open, or null. */
  function waitingBox() {
    const st = store.state;
    if (!st) return null;
    let list = [];
    try { list = giftsFor(st, store.pid); } catch { list = []; }
    const hit = list.find(([id]) => Object.hasOwn(st.farm.objects, id) && Number.isFinite(st.farm.objects[id].x));
    return hit ? st.farm.objects[hit[0]] : null;
  }
  function labelButtons() {
    // a finger has no G or T: no key hint in what a screen reader says on a phone (S9a, ux-phone#19)
    const touch = touchPlayer(controller);
    const set = (b, label, tip, caption) => {
      b.setAttribute('aria-label', touchText(label, touch));
      b.dataset.tip = tip;
      b.dataset.label = caption;
      // the caption under the tile in the phone's Farm book: a real element, so the book can fit it to its column (QA r1
      // S-33; a ::after caption could not be measured and overlapped its neighbour)
      let cap = [...b.children].find((c) => c.classList?.contains('lbl'));
      if (!cap) { cap = h('span.lbl', { 'aria-hidden': 'true' }); b.append(cap); }
      cap.textContent = caption;
    };
    set(pingBtn, t('social.ping.label'), t('social.ping.tip'), t('social.ping.caption'));
    set(emoteBtn, t('social.emotes.label'), t('social.emotes.label'), t('social.emotes.caption'));
    set(notesBtn, t('social.notes.label'), t('social.notes.tip'), t('social.notes.label'));
    set(chatBtn, t('social.chat.label'), t('social.chat.tip'), t('social.chat.caption'));
    // a surprise waiting for me: the gift's door says "Open your surprise" and both doors carry a dot (QA r3 S3-C2, coop#2:
    // once the toast and the feed line faded after 8 s nothing led to the box)
    const waiting = Boolean(waitingBox());
    if (waiting) set(giftBtn, t('dock.together.giftOpen'), t('dock.together.giftOpen'), t('dock.together.giftOpenShort'));
    else set(giftBtn, t('dock.together.gift'), t('dock.together.giftTip', { name: partnerName() }), t('dock.together.giftShort'));
    giftBtn.classList.toggle('has-gift', waiting);
    togetherBtn.classList.toggle('has-gift', waiting);
    togetherBtn.setAttribute('aria-label', waiting ? t('dock.together.labelGift', { name: partnerName() }) : t('dock.together.label', { name: partnerName() }));
    togetherBtn.dataset.tip = waiting ? t('dock.together.giftOpen') : t('dock.together.tip', { name: partnerName() });
    together.setAttribute('aria-label', t('dock.together.menu'));
  }
  // ---- the Together button (release 1.0 S4, ux-first#5): ping, emote, say, notes and "Leave a surprise" behind ONE
  // button, shown only while a partner is claimed (a solo farmer had four partner buttons from L1). On a phone the Farm
  // book's Together page shows the same buttons (ui/layout.js borrows #social; css/mobile.css lays them out as tiles)
  // a group of buttons (ping is a toggle, emotes opens its wheel), not a menu of menuitems (axe, P9 audit)
  const together = h('div.together-menu.paper', { role: 'group', id: 'together-menu', hidden: true }, pingBtn, emoteBtn, chatBtn, notesBtn, giftBtn);
  const togetherBtn = h('button.social-btn.together-btn#together-btn', { type: 'button', 'aria-expanded': 'false',
    'aria-controls': 'together-menu', on: { click: () => (together.hidden ? openTogether() : closeTogether()) } }, svgIcon('heart', 30));
  function openTogether() {
    together.hidden = false;
    togetherBtn.setAttribute('aria-expanded', 'true');
    together.querySelector('button')?.focus({ preventScroll: true });
  }
  function closeTogether({ focus = false } = {}) {
    if (together.hidden) return;
    together.hidden = true;
    togetherBtn.setAttribute('aria-expanded', 'false');
    if (focus) togetherBtn.focus({ preventScroll: true });
  }
  together.addEventListener('keydown', (e) => {
    const items = [...together.querySelectorAll('button')].filter((b) => !b.hidden);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTogether({ focus: true }); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });
  // a choice in the menu puts it away (the chat line and the wheel open over the farm)
  together.addEventListener('click', (e) => { if (e.target.closest?.('button')) closeTogether(); });
  // the menu as tiles inside the phone's Farm book (ui/layout.js borrows #social): the book owns it there, so a touch
  // elsewhere in the book (a drag that scrolls it, its heading) never empties its Together row (QA r1 S-10)
  const inBook = () => Boolean(box.closest?.('.farm-book'));
  document.addEventListener('pointerdown', (e) => { if (!together.hidden && !inBook() && !box.contains(e.target)) closeTogether(); }, true);
  // P9 (QA r1 S-27): Escape closes the open menu wherever the focus went (the menu's own key handler only saw it while
  // the focus was inside), focus leaving the box closes it, and a panel opening over the farm puts it away
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || together.hidden || inBook() || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    closeTogether({ focus: box.contains(document.activeElement) || document.activeElement === document.body });
  }, true);
  box.addEventListener('focusout', (e) => {
    if (together.hidden || inBook() || (e.relatedTarget && box.contains(e.relatedTarget))) return;
    // a click on a menu button moves no focus out of the box; a Tab past its last button does
    if (e.relatedTarget) closeTogether();
  });
  ui.panels?.on?.('open', () => { if (!inBook()) closeTogether(); });
  const partnerPid = () => Object.keys(store.state?.players ?? {}).find((p) => p !== store.pid) ?? null;
  const partnerName = () => (partnerPid() ? store.state.players[partnerPid()].name : t('common.partner'));
  /** Together shows only with a partner claimed (and the gift only where the rules have it). */
  function refreshTogether() {
    const has = Boolean(partnerPid());
    box.hidden = !has;
    box.classList.toggle('has-partner', has);
    giftBtn.hidden = !has || !ACTIONS.leaveGift && !ACTIONS.gift && !ACTIONS.keepsake;
    if (!has) closeTogether();
    labelButtons();
  }
  store.subscribe('players', refreshTogether);
  store.on('welcome', refreshTogether);
  controller.on?.('input', labelButtons);
  // the waiting surprise's dot and words follow the box (left, opened, shelved after 48 h)
  let giftShown = null;
  const giftCue = () => { const w = Boolean(waitingBox()); if (w !== giftShown) { giftShown = w; labelButtons(); } };
  store.subscribe('gifts', giftCue);
  store.subscribe('objects', giftCue);

  // ---- D2 (features#F2): the partner sits on a two-seat bench while I am here: a chip for 2 minutes, "Join" walks me
  // over and sits me down (the controller's Hand-on-bench path: walk first, sit on arrival) --------------------------
  const BENCH_MS = 120_000;
  const benchText = h('span.bc-t');
  const benchJoin = h('button.btn.btn--sun.btn--small.bc-join', { type: 'button', on: { click: () => joinBench() } });
  const benchChip = h('div.bench-chip', { role: 'status', 'aria-live': 'polite', hidden: true }, benchText, benchJoin);
  document.getElementById('hud')?.append(benchChip);
  let benchTimer = 0;
  let benchId = null;
  function renderBench() {
    clearTimeout(benchTimer);
    const st = store.state;
    const p = partnerPid();
    const seats = st?.farm?.coop?.bench ?? {};
    const theirs = p ? seats[p] : null;
    const online = p && (S.hud?.isOnline ? S.hud.isOnline(p) : true);
    const now = store.now?.() ?? Date.now();
    const left = theirs ? theirs.at + BENCH_MS - now : 0;
    const show = Boolean(theirs && !seats[store.pid] && online && left > 0 && st.farm.objects[theirs.id] && benchUseful(st, store.pid, now));
    benchChip.hidden = !show;
    benchId = show ? theirs.id : null;
    if (!show) return;
    benchText.textContent = t('dock.bench.waiting', { name: st.players[p].name });
    benchJoin.textContent = t('dock.bench.join');
    benchJoin.setAttribute('aria-label', t('dock.bench.joinLabel', { name: st.players[p].name }));
    benchTimer = setTimeout(renderBench, Math.min(left + 50, BENCH_MS));
  }
  function joinBench() {
    const st = store.state;
    const o = benchId && st?.farm?.objects?.[benchId];
    if (!o) { renderBench(); return; }
    // show the bench I am joining (verify-1 V1-S1): it was often off screen, and the two of us sat down and started
    // Golden Hour where neither could see it. The tracker's Golden Hour card focuses on its own, so not in sitOn
    if (typeof view?.focus === 'function') view.focus(o.x + 0.5, o.z + 0.5);
    if (typeof controller.sitOn === 'function') controller.sitOn(benchId);
    else { if (controller.tool?.id !== 'hand') controller.setTool('hand'); controller.actOn?.({ kind: 'object', id: benchId, x: o.x, z: o.z }); }
    benchChip.hidden = true;
  }
  store.subscribe('coop', renderBench);
  store.subscribe('players', renderBench);
  store.on('welcome', renderBench);
  onLang(renderBench);
  // the shell is built after the first welcome: draw both now
  if (store.state) { refreshTogether(); renderBench(); }
  labelButtons();
  onLang(() => { labelButtons(); refreshUnread(); });
  box.append(togetherBtn, together);

  // ---- chat: a one-line message, shown in the partner's feed (textContent only) ----------------------------
  let chatBox = null;
  function toggleChat(open = !chatBox) {
    if (!open) { chatBox?.remove(); chatBox = null; chatBtn.setAttribute('aria-expanded', 'false'); return; }
    if (chatBox) return;
    const input = h('input.field', { type: 'text', maxlength: String(LIMITS.CHAT_MAX), placeholder: t('social.chat.placeholder'), 'aria-label': t('social.chat.input'), autocomplete: 'off' });
    const sendIt = () => {
      const text = input.value.replace(/\s+/g, ' ').trim().slice(0, LIMITS.CHAT_MAX);
      if (!text) { toggleChat(false); return; }
      send({ t: MSG.CHAT, text });          // the server echoes it to everyone, the sender included (the feed line)
      toggleChat(false);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendIt(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleChat(false); chatBtn.focus(); }
    });
    chatBox = h('div.chat-box.paper', input, h('button.btn.btn--small', { type: 'button', on: { click: sendIt } }, t('social.chat.send')));
    box.before(chatBox);
    chatBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  }
  // an empty chat line goes when the player turns to the farm or a panel comes up; one with words waits for Send (QA r2
  // S-18, oib#8: on a phone it stayed over the farm until an empty Send)
  const chatEmpty = () => !String(chatBox?.querySelector('input')?.value ?? '').trim();
  canvas?.addEventListener('pointerdown', () => { if (chatBox && chatEmpty()) toggleChat(false); }, true);
  ui.panels?.on?.('open', () => { if (chatBox && chatEmpty()) toggleChat(false); });
  // every chat line the feed has shown, by farmer and time: a welcome's history after a reconnect repeats the newest
  // lines (QA r2 S-12, coop#3: "Ти каза" three times after two drops)
  const chatSeen = new Set();
  const chatKey = (m) => `${m.pid}|${m.ts ?? ''}|${m.text}`;
  function chatLine(m) {
    if (!m || typeof m.text !== 'string' || !m.pid) return;
    chatSeen.add(chatKey(m));
    const mine = m.pid === store.pid;
    // a chat line has a verb like every feed line: '<name> says “...”' (QA wave 1 ui-ux-20)
    S.feed?.push({ by: m.pid, actor: nameOf(m.pid), text: t(mine ? 'social.chat.sayMine' : 'social.chat.says', { text: m.text.slice(0, LIMITS.CHAT_MAX) }), glyph: 'chat', at: m.ts });
    if (!mine) ui.toast(t('social.chat.toast', { name: nameOf(m.pid), text: `${m.text.slice(0, 80)}${m.text.length > 80 ? '…' : ''}` }), { kind: 'love', ms: 5000 });
  }
  const refreshNotes = () => { notesBtn.hidden = !ui.panels.has('notes'); };
  ui.panels.on('register', refreshNotes);
  refreshNotes();

  // ---- unread notes: the partner's notes newer than my last look at the Notes panel (RD-30) ------------------
  const seenKey = () => `hh.notesSeen.${store.pid}`;
  const unreadBadge = h('span.badge.badge--gold', { 'aria-hidden': 'true', hidden: true });
  notesBtn.append(unreadBadge);
  function refreshUnread() {
    const notes = store.state?.farm?.notes ?? {};
    const seen = Number(kv.get(seenKey(), 0)) || 0;
    const n = Object.values(notes).filter((x) => x && x.by !== store.pid && x.at > seen).length;
    unreadBadge.hidden = n === 0;
    unreadBadge.textContent = String(n);
    notesBtn.setAttribute('aria-label', n ? tn('social.notes.unread', n) : t('social.notes.label'));
  }
  ui.panels.on('open', (name) => {
    if (name !== 'notes') return;
    kv.set(seenKey(), Math.round(store.now ? store.now() : Date.now()));
    refreshUnread();
  });
  store.subscribe('notes', refreshUnread);
  store.on('welcome', refreshUnread);

  // ---- ping --------------------------------------------------------------------------------------------------
  function ping(x, z, kind = 'look') {
    const t = performance.now();
    if (t - lastPing < PING_GAP_MS) return false;
    lastPing = t;
    const mark = { x: Math.round(x * 20) / 20, z: Math.round(z * 20) / 20, kind: MARKS.includes(kind) ? kind : 'look' };
    // the controller's ping sends, draws and plays the chime in one place; older controllers: send it here
    if (typeof controller.ping === 'function' && kind === 'look') controller.ping(mark.x, mark.z);
    else { send({ t: MSG.MARK, ...mark }); showMark(store.pid, mark); }
    S.tutorial?.did('ping');
    return true;
  }
  function arm(on) {
    // pressed from the phone's farm menu: the button is out of sight, so say what the next tap does
    if (on && !pingBtn.getClientRects().length) ui.toast(t('social.ping.armed'), { kind: 'info', ms: 2600 });
    armed = on;
    pingBtn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('ping-armed', on);
    canvas.style.cursor = on ? 'crosshair' : '';
  }
  // an armed ping eats the next left click on the farm (capture: the controller never sees it)
  canvas.addEventListener('pointerdown', (e) => {
    if (!armed || e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    arm(false);
    const r = canvas.getBoundingClientRect();
    const p = view.pick({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    if (p) ping(p.px ?? p.x, p.pz ?? p.z);
  }, true);
  let mid = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 1) mid = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('auxclick', (e) => {
    if (e.button !== 1 || !mid || Math.hypot(e.clientX - mid.x, e.clientY - mid.y) > 6) return;
    mid = null;
    const r = canvas.getBoundingClientRect();
    const p = view.pick({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    if (p) ping(p.px ?? p.x, p.pz ?? p.z);
  });

  function showMark(pid, m) {
    const av = avatars();
    if (av && typeof av.ping === 'function') av.ping(pid, m.x, m.z);
    else if (view.fx) view.fx.play({ e: 'ping', color: store.state?.players?.[pid]?.color }, { x: m.x, z: m.z });
    if (pid !== store.pid) S.feed?.push({ by: pid, actor: nameOf(pid), text: m.kind === 'help' ? t('social.ping.help') : t('social.ping.did'), glyph: 'ping' });
  }

  // ---- emotes ----------------------------------------------------------------------------------------------
  function emote(id) {
    if (!EMOTES.includes(id)) return;
    const t = performance.now();
    if (t - lastEmote < 1000) return;
    lastEmote = t;
    if (typeof controller.emote === 'function') controller.emote(id);       // sends, bubbles, sound, high-five action
    else {
      send({ t: MSG.EMOTE, id });
      showEmote(store.pid, id);
      if (id === 'high_five' && ACTIONS.highFive) controller.do('highFive', {});
    }
    S.tutorial?.did('ping');
  }
  function showEmote(pid, id) {
    const info = EMOTE_INFO[id];
    const av = avatars();
    if (av) {
      if (id === 'high_five' && typeof av.highFive === 'function') av.highFive(pid);
      else if (info && info[2] && typeof av.emote === 'function') av.emote(pid, info[2]);
    }
    if (pid !== store.pid && info) S.feed?.push({ by: pid, actor: nameOf(pid), text: `${info[3]} ${info[0]}`, glyph: null });
  }

  function closeWheel() {
    if (!wheel) return;
    wheel.remove();
    wheel = null;
    emoteBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleWheel(anchor, at = null) {
    if (wheel) { closeWheel(); return; }
    // an anchor that is not on screen (the phone keeps it in the farm menu): the wheel opens in the middle
    const r = anchor && anchor.getClientRects().length ? anchor.getBoundingClientRect() : null;
    const cx = at ? at.x : r ? r.left + r.width / 2 + 90 : innerWidth / 2;
    const cy = at ? at.y : r ? r.top - 120 : innerHeight / 2;
    const hub = h('span.hub', t('social.emotes.hub'));
    wheel = h('div.emote-wheel', { role: 'menu', 'aria-label': t('social.emotes.caption'), style: { left: `${Math.max(126, Math.min(innerWidth - 126, cx))}px`, top: `${Math.max(126, Math.min(innerHeight - 126, cy))}px` } }, hub);
    EMOTES.forEach((id, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const [emoji, label] = EMOTE_INFO[id] || ['★', id];
      const b = h('button', {
        type: 'button', role: 'menuitem', 'aria-label': label,
        style: { left: `${118 + Math.cos(a) * 82}px`, top: `${118 + Math.sin(a) * 82}px` },
        on: {
          click: () => { emote(id); closeWheel(); },
          pointerenter: () => { hub.textContent = label; },
          focus: () => { hub.textContent = label; },
        },
      }, emoji);
      wheel.append(b);
    });
    wheel.addEventListener('keydown', (e) => {
      const items = [...wheel.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWheel(); emoteBtn.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (/^[1-8]$/.test(e.key)) { e.preventDefault(); items[Number(e.key) - 1].click(); }
    });
    document.body.append(wheel);
    emoteBtn.setAttribute('aria-expanded', 'true');
    wheel.querySelector('button').focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => { if (wheel && !wheel.contains(e.target) && e.target !== emoteBtn && !emoteBtn.contains(e.target)) closeWheel(); });

  // ---- keys: the controller's keymap owns G and T (rebindable, physical keys) and announces them ------------
  let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  window.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  controller.on('command', (c) => {
    if (!c) return;
    if (c.cmd === 'ping') {
      if (hover) ping(hover.px ?? hover.x, hover.pz ?? hover.z);
      else arm(true);
    } else if (c.cmd === 'emotes') {
      toggleWheel(null, mouse);
    } else if (c.cmd === 'seedTray') {
      S.toolbar?.openSeeds(true);
    }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && armed) arm(false); });

  return {
    /** The partner came or went (ui.setPeer): the bench chip follows. */
    peer: () => renderBench(),
    /** A relayed emote from someone (MSG.EMOTE { pid, id }). */
    emote: (pid, id) => showEmote(pid, id),
    /** A relayed ping (MSG.MARK { pid, x, z, kind }). */
    mark: (pid, m) => showMark(pid, m),
    sendEmote: emote,
    ping,
    /** A relayed chat line (MSG.CHAT { pid, ts, text }). */
    chat: chatLine,
    /** welcome.chat: the newest lines, oldest first (late joiners); the feed shows the last few. */
    chatHistory(list) {
      for (const m of (Array.isArray(list) ? list : []).slice(-3)) {
        if (!m || typeof m.text !== 'string' || chatSeen.has(chatKey(m))) continue;
        chatSeen.add(chatKey(m));
        S.feed?.push({ by: m.pid, actor: nameOf(m.pid), text: t('social.chat.said', { text: m.text }), glyph: 'chat', at: m.ts });
      }
    },
  };
}
