// Co-op comms corner (GDD §6.2 #2 pings/emotes/notes, #10 high-five; §7.3 bottom-left): the Ping button (G: ping
// at the cursor; the button arms a one-click ping), the emote wheel (T), the Notes button (opens the 'notes' panel
// when ui-panels registers it). Incoming relays arrive through ui.emote(pid, id) / ui.mark(pid, mark) (main.js
// routes MSG.EMOTE / MSG.MARK there). The 3D bubble, marker and off-screen arrow are render-life's
// (view.avatars.emote / ping / highFive); this module sends, captions in the feed and keeps the 1-per-second
// manners. ui-shell lane.
import { EMOTES, MARKS, MSG, LIMITS } from '../../../shared/net/protocol.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { h, svgIcon, kv } from './dom.js';

/** Protocol emote id -> [emoji, label, render-life bubble kind]. */
export const EMOTE_INFO = Object.freeze({
  wave: ['👋', 'Wave', 'wave', 'waves'],
  heart: ['💖', 'Love', 'heart', 'sends love'],
  laugh: ['😄', 'Laugh', 'laugh', 'laughs'],
  thumbs_up: ['👍', 'Thumbs up', 'thumbs', 'gives a thumbs up'],
  come_here: ['🙋', 'Come here!', 'come', 'calls you over'],
  cheer: ['🎉', 'Cheer', 'star', 'cheers'],
  high_five: ['✋', 'High five', null, 'holds up a hand for a high five'],
  dance: ['💃', 'Dance', 'wow', 'dances'],
});

const PING_GAP_MS = 1000;

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
  const nameOf = (pid) => (pid === store.pid ? 'You' : store.state?.players?.[pid]?.name ?? 'Your partner');

  controller.on('hover', (p) => { hover = p; });

  // ---- buttons ---------------------------------------------------------------------------------------------
  const pingBtn = h('button.social-btn', {
    type: 'button', 'aria-label': 'Ping a spot for your partner (G)', 'data-tip': 'Ping a spot (G): click, then click the farm',
    'aria-pressed': 'false', dataset: { label: 'Ping' }, on: { click: () => arm(!armed) },
  }, svgIcon('ping', 32), h('span.key', { 'aria-hidden': 'true' }, 'G'));
  const emoteBtn = h('button.social-btn', {
    type: 'button', 'aria-label': 'Emotes (T)', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-tip': 'Emotes (T)',
    dataset: { label: 'Emotes' }, on: { click: () => toggleWheel(emoteBtn) },
  }, svgIcon('smile', 32), h('span.key', { 'aria-hidden': 'true' }, 'T'));
  const notesBtn = h('button.social-btn', {
    type: 'button', 'aria-label': 'Notes', 'data-tip': 'Notes for each other', dataset: { label: 'Notes' },
    on: { click: () => (ui.panels.has('notes') ? ui.panels.toggle('notes') : ui.toast('Notes arrive soon. Pings and emotes work now.', { kind: 'info' })) },
  }, svgIcon('note', 32));
  const chatBtn = h('button.social-btn', {
    type: 'button', 'aria-label': 'Say something', 'aria-expanded': 'false', 'data-tip': 'Say something to your partner',
    dataset: { label: 'Chat' }, on: { click: () => toggleChat() },
  }, svgIcon('chat', 30));
  box.append(pingBtn, emoteBtn, chatBtn, notesBtn);

  // ---- chat: a one-line message, shown in the partner's feed (textContent only) ----------------------------
  let chatBox = null;
  function toggleChat(open = !chatBox) {
    if (!open) { chatBox?.remove(); chatBox = null; chatBtn.setAttribute('aria-expanded', 'false'); return; }
    const input = h('input.field', { type: 'text', maxlength: String(LIMITS.CHAT_MAX), placeholder: 'Say something nice…', 'aria-label': 'Message to your partner', autocomplete: 'off' });
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
    chatBox = h('div.chat-box.paper', input, h('button.btn.btn--small', { type: 'button', on: { click: sendIt } }, 'Send'));
    box.before(chatBox);
    chatBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  }
  function chatLine(m) {
    if (!m || typeof m.text !== 'string' || !m.pid) return;
    const mine = m.pid === store.pid;
    // a chat line has a verb like every feed line: 'Rowan says “...”' (QA wave 1 ui-ux-20)
    S.feed?.push({ by: m.pid, actor: mine ? 'You' : nameOf(m.pid), text: `${mine ? 'say' : 'says'} “${m.text.slice(0, LIMITS.CHAT_MAX)}”`, glyph: 'chat', at: m.ts });
    if (!mine) ui.toast(`${nameOf(m.pid)}: “${m.text.slice(0, 80)}${m.text.length > 80 ? '…' : ''}”`, { kind: 'love', ms: 5000 });
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
    notesBtn.setAttribute('aria-label', n ? `Notes (${n} new from your partner)` : 'Notes');
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
    if (on && !pingBtn.getClientRects().length) ui.toast('Tap a spot on the farm to ping it for your partner.', { kind: 'info', ms: 2600 });
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
    if (pid !== store.pid) S.feed?.push({ by: pid, actor: nameOf(pid), text: m.kind === 'help' ? 'asks for help here' : 'pinged a spot', glyph: 'ping' });
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
    const hub = h('span.hub', 'Say it with a wave');
    wheel = h('div.emote-wheel', { role: 'menu', 'aria-label': 'Emotes', style: { left: `${Math.max(126, Math.min(innerWidth - 126, cx))}px`, top: `${Math.max(126, Math.min(innerHeight - 126, cy))}px` } }, hub);
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
        if (m && typeof m.text === 'string') S.feed?.push({ by: m.pid, actor: m.pid === store.pid ? 'You' : nameOf(m.pid), text: `said “${m.text}”`, glyph: 'chat', at: m.ts });
      }
    },
  };
}
