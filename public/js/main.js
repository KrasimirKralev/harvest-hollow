// Boot: identity -> socket -> welcome -> store -> view + ui + controller + audio, plus the window.__hh test hook.
// Owned by the client-core lane.
//
// Identity (tech §7 rule 8): tokens per slot in localStorage['hh.tokens'] = { p1: token, ... } (shared by
// the browser's tabs); the slot THIS tab plays in sessionStorage['hh.slot'], so two tabs of one browser can
// be the two partners on one machine. URL params ?slot=p1&name=Rowan claim/resume without the picker
// (used by tools/shot.mjs and tools/e2e-coop.mjs).
//
// Server messages go through a per-animation-frame INBOX (GDD App. F "coalesce deltas per animation frame"):
// everything that arrived since the last frame is handled in arrival order, and each run of d/rej/ack becomes
// ONE store.onServerBatch() (one rewind, all changes, one replay). A 20 ms timer flushes when frames do not run
// (a hidden tab). The clock sample of a pong is taken by the socket at receipt, never deferred.
import { view } from './render/index.js';
import { ui } from './ui/index.js';
import { audio, UNLOCK_EVENTS } from './audio.js';
import { SyncStore } from './net/sync.js';
import { Socket } from './net/socket.js';
import { contentGate, pageBuild, reloadPlan, unsavedOf, noteUnsaved, unsavedText } from './net/content-gate.js';
import { createPeerTools } from './net/peers.js';
import { createController } from './game/controller.js';
import { createAvatar } from './game/avatar.js';
import { createFeedback } from './game/feedback.js';
import { createMemory } from './game/memory.js';
import { createRest } from './game/rest.js';
import { route } from './game/path.js';
import { spawnAt } from '../../shared/rules/grid.js';
import { createWalkMarker } from './game/walk-marker.js';
import { createViewport } from './game/viewport.js';
import { createDevice } from './game/device.js';
import { createTouchBuild } from './game/touch-build.js';
import { createFishingHud } from './game/fishing-hud.js';
import { createModeChip } from './game/mode-chip.js';
import { createM2Moments } from './game/m2-moments.js';
import { ClockSync } from '../../shared/net/clock.js';
import { makeCid } from '../../shared/net/ids.js';
import { MSG, ERR, PROTOCOL_VERSION, CAPS } from '../../shared/net/protocol.js';
import { CONTENT_HASH, furnitureOf } from '../../shared/content/index.js';
import { RULES_VERSION } from '../../shared/rules/version.js';

const storage = {
  get(area, key) { try { return JSON.parse(area.getItem(key)); } catch { return null; } },
  set(area, key, v) { try { area.setItem(key, JSON.stringify(v)); } catch { /* private mode: identity lasts this page only */ } },
};
const params = new URLSearchParams(location.search);
const ident = {
  tokens: storage.get(localStorage, 'hh.tokens') || {},
  slot: params.get('slot') || storage.get(sessionStorage, 'hh.slot'),
  name: params.get('name'),
  used: null,
};
const saveTokens = () => storage.set(localStorage, 'hh.tokens', ident.tokens);

const cid = makeCid((n) => crypto.getRandomValues(new Uint8Array(n)));   // not randomUUID: LAN pages are not secure contexts
const clock = new ClockSync();
const serverNow = () => clock.serverNow(performance.now());
let socket = null;
const store = new SyncStore({ cid, now: serverNow, send: (m) => socket.send(m) });
let started = false;
// The build hash of the files this page runs (SV-03): the server's <meta name="hh-build">, else /api/status at boot
let myBuild = pageBuild({ meta: document.querySelector('meta[name="hh-build"]')?.content ?? null });
let controller = null;
let avatar = null;
let feedback = null;
/** The partner's presence tool ('horse' while riding): the controller counts riders against the farm's horses.
 *  Only while that farmer is online (qa2 CL-01: a partner who left on horseback held the only horse forever). */
const peerTools = createPeerTools();
/** Per-tab record of actions a deploy's reload did not save (CL-02), shown once the reloaded page is up. */
const unsavedMemo = {
  get: () => storage.get(sessionStorage, 'hh.unsaved'),
  set: (v) => storage.set(sessionStorage, 'hh.unsaved', v),
  clear: () => { try { sessionStorage.removeItem('hh.unsaved'); } catch { /* storage blocked */ } },
};
/** How long a stale tab waits for its re-sent actions to be answered before it reloads anyway (CL-02). */
const RELOAD_SETTLE_MS = 8000;
let reloading = false;

function hello(claim) {
  // caps ['b']: this client unpacks batch frames (socket.js), so the server may send one frame per tick
  const msg = { t: MSG.HELLO, proto: PROTOCOL_VERSION, cid, caps: [CAPS.BATCH] };
  const mine = Object.keys(ident.tokens);
  if (claim) msg.claim = claim;
  else if (ident.slot && ident.tokens[ident.slot]) { msg.token = ident.tokens[ident.slot]; ident.used = ident.slot; }
  else if (!ident.slot && mine.length === 1) { msg.token = ident.tokens[mine[0]]; ident.used = mine[0]; }
  else if (ident.slot && ident.name) msg.claim = { slot: ident.slot, name: ident.name };
  socket.raw(msg);
}

/**
 * The slot picker. `pass`: the server needs the farm passphrase for claims and reclaims; the ui passes
 * { pass?, reclaim?, color? } as the third argument of onPick ("this is me on a new device", lost token, the
 * colour picked on the card).
 */
function pickSlot(slots, pass) {
  ui.showSlots(slots.map((s) => ({ ...s, mine: Boolean(ident.tokens[s.pid]), pass })), (slot, name, extra = {}) => {
    ident.slot = slot;
    const claim = name ? { slot, name } : null;
    if (claim && typeof extra.pass === 'string' && extra.pass) claim.pass = extra.pass;
    if (claim && extra.reclaim === true) claim.reclaim = true;
    if (claim && typeof extra.color === 'string' && /^#[0-9a-f]{6}$/i.test(extra.color)) claim.color = extra.color;
    hello(claim);
  });
}

function onWelcome(w) {
  // Identity first, whatever happens next: a reload below must never throw a fresh claim's token away.
  if (w.token) { ident.tokens[w.pid] = w.token; saveTokens(); }
  ident.slot = w.pid;
  storage.set(sessionStorage, 'hh.slot', w.pid);
  const gate = contentGate(w, { content: CONTENT_HASH, build: myBuild }, {
    get: () => storage.get(sessionStorage, 'hh.reloadedFor'),
    set: (v) => storage.set(sessionStorage, 'hh.reloadedFor', v),
  });
  if (reloading) return;                               // already on the way out (a second welcome while settling)
  let settle = null;
  if (gate === 'reload') {
    // Actions predicted while the server restarted (CL-02 / SV-01): re-sent first when the rules are the same,
    // otherwise remembered, so the reloaded page can say they were not saved instead of dropping them silently.
    const pending = store.state ? store.pending.length : 0;
    const plan = reloadPlan(w, { content: CONTENT_HASH, rules: RULES_VERSION }, pending);
    if (plan !== 'send') {
      if (plan === 'note') noteUnsaved(unsavedMemo, unsavedOf(store.pending, w));
      reloading = true;
      location.reload();
      return;
    }
    settle = watchUnsaved();                            // listens before reset(): it reports lost / rejected ones
  }
  if (gate === 'mismatch') { ui.hideSlots(); ui.setConnection('mismatch'); return; }
  ui.hideSlots();
  clock.seed(w.serverNow, performance.now());
  store.reset(w);
  if (!started) {
    started = true;
    // the farmer goes round buildings and fences (game/path.js); the router reads the predicted farm
    avatar = createAvatar({ view, send: (m) => socket.raw(m), pid: w.pid, route: (from, to) => (store.state ? route(store.state, from, to) : null),
      at: spawnAt(store.state, w.pid) });
    controller = createController({
      store, view, avatar, ui, audio,
      canvas: document.getElementById('world'),
      send: (m) => socket.raw(m),
      toast: (c, o) => ui.toast(c, o),
      peerTool: (pid) => peerTools.get(pid),
    });
    avatar.setTool(controller.tool.id);
    // the world shows the full water pins only while the Watering Can is out (render-world, VISUAL-AFTER #5)
    view.setTool?.(controller.tool.id);
    controller.on('tool', (t) => { avatar.setTool(t.id); view.setTool?.(t.id); });
    // a decor set placed piece by piece: light exactly the copies this spot would join (render-world's glow)
    controller.on('build', (e) => view.ghost.setIds?.(e?.set?.ids ?? null));
    feedback = createFeedback({ store, controller, view, audio, ui });
    // a Hand click on open ground: a ring in my colour where my farmer is going (live requests 2026-10-04)
    const marker = createWalkMarker({ view, avatar, overlay: document.getElementById('overlay'), color: store.state.players[w.pid]?.color });
    controller.on('walk', (at) => marker.show(at.x, at.z));
    store.subscribe?.('players', () => marker.setColor(store.state?.players[store.pid]?.color));
    window.__hh.walkMarker = marker;
    // the Memory Book's pictures, kept in this browser (M1b): the ui reads them with controller.memory.picture(n)
    const memory = createMemory({ store, view });
    controller.memory = memory;
    controller.on('photo', ({ blob }) => memory.photo(blob));
    window.__hh.memory = memory;
    // phones (mobile wave): the wake lock and the fullscreen toggle for the ui (controller.device), and the ⟳ ✕ ✓ bar
    // under the build ghost for a touch player
    const device = createDevice({ options: () => controller.options });
    controller.device = device;
    window.__hh.device = device;
    window.__hh.touchBuild = createTouchBuild({ controller, view, ui });
    ui.init(store, view, controller);
    wireM2();
    window.__hh.controller = controller;
    window.__hh.avatar = avatar;
    window.__hh.feedback = feedback;
    startAudioSoon();
    // the deploy's reload did not save something this tab had shown done (CL-02): say so once, now that it is up
    const text = unsavedText(unsavedMemo.get());
    unsavedMemo.clear();
    if (text) ui.notice(text);
  } else {
    // a reconnect (or a server restart): the server forgot my pose and put me back at the porch; send where I
    // really stand, as a hop, even if I never move again (coop-robust-06: the partner saw me at the porch and a
    // high-five next to each other failed until I moved)
    avatar.resync();
  }
  view.setState(store.state, { me: w.pid });
  peerTools.welcome(w.peers);
  syncPresent();
  for (const p of w.peers || []) {
    view.partner.online(p.pid, p.online);
    ui.setPeer(p.pid, p.online);
    if (p.pose) view.partner.update([p.pose], w.serverNow);
    if (!p.online) view.avatars?.ride?.(p.pid, false);
  }
  if (Array.isArray(w.chat) && typeof ui.chatHistory === 'function') ui.chatHistory(w.chat);
  document.title = `Harvest Hollow · ${store.state.players[w.pid]?.name ?? ''}`;
  if (settle) settle();
}

/**
 * The M2 input's own on-screen pieces (wave 3): the fishing cast's bobber and card, the mode chip (the Breeding Barn's
 * matchmaker, the farmhouse room), and the moments said between the panels (a duel invitation, a bred baby ready, a
 * full Nursery card, a perk point). After ui.init: they live in the HUD the ui built.
 */
function wireM2() {
  const hudEl = document.getElementById('hud');
  const overlayEl = document.getElementById('overlay');
  if (!hudEl || !overlayEl) return;
  const motion = () => (document.body.classList.contains('motion-reduced') ? 'reduced' : 'full');
  window.__hh.fishingHud = createFishingHud({ fishing: controller.fishing, view, hud: hudEl, overlay: overlayEl, now: serverNow,
    pid: () => store.pid, input: () => controller.input, motion });
  const chip = createModeChip({ hud: hudEl, input: () => controller.input });
  window.__hh.modeChip = chip;
  controller.pairing.on('pair', (p) => {
    if (!p.active) { chip.hide('pair'); return; }
    chip.show('pair', { text: p.text, icon: 'heart', tone: 'love', action: { label: 'Cancel', fn: () => controller.pairing.cancel() } });
  });
  controller.interior.on('change', (r) => {
    if (!r.inside && !r.going) { chip.hide('room'); return; }
    if (r.held) {
      const def = furnitureOf(r.held.def);
      const name = def ? def.name : r.held.def.replace(/_/g, ' ');
      const turn = def && def.layer !== 'wall' ? (controller.input === 'touch' ? '' : ' · R turns it') : '';
      chip.show('room', { text: `${r.held.id ? 'Move' : 'Place'} the ${name}${r.valid || !r.spot ? '' : ': not there'}${turn}`, icon: 'chair', tone: 'home',
        action: { label: 'Cancel', fn: () => controller.interior.cancel() } });
      return;
    }
    // inside: the room panel's catalog (ui-home `farmhouse`, tab 'room') is one tap away
    const furnish = !r.going && ui.panels?.has?.('farmhouse')
      ? { label: 'Furnish', fn: () => ui.panels.open('farmhouse', { tab: 'room' }) } : null;
    chip.show('room', { text: r.going ? 'Off to the farmhouse…' : "Grandma's Farmhouse", icon: 'house', tone: 'home', extra: furnish,
      action: { label: 'Leave', fn: () => controller.interior.leave('chip') } });
  });
  controller.interior.on('change', () => syncPresent());
  // the first-use tips of the world's M2 systems (content TUTORIAL.firstUse 'fishing', 'interior'), through the ui's
  // tutorial when it offers the hook (ui.firstUse; the tutorial shows each tip once)
  const tip = (id) => { try { ui.firstUse?.(id); } catch (err) { console.warn('first-use tip failed', err); } };
  controller.fishing.on('phase', (e) => { if (e.phase === 'cast') tip('fishing'); });
  controller.interior.on('change', (r) => { if (r.inside) tip('interior'); });
  window.__hh.m2 = createM2Moments({ store, ui, controller, audio });
}

/**
 * Who stands inside the farmhouse room (render-world draws them by the fire): me while I am in, the partner while their
 * presence says 'indoors' (avatar.setActivity, game/interior.js). Called on presence and on my own going in and out.
 */
let lastPresent = '';
function syncPresent() {
  const vi = view.interior;
  if (!vi || typeof vi.setPresent !== 'function' || !controller || !store.state) return;
  const pids = [];
  if (controller.interior?.inside) pids.push(store.pid);
  for (const pid of Object.keys(store.state.players).sort()) if (pid !== store.pid && peerTools.get(pid) === 'indoors') pids.push(pid);
  const k = pids.join(',');
  if (k === lastPresent) return;
  lastPresent = k;
  try { vi.setPresent(pids); } catch (err) { console.warn('view.interior.setPresent failed', err); }
}

/**
 * A build-only deploy with actions pending (CL-02): count what the re-send does not save (rejected now, lost by a
 * server that forgot this cid) and reload once nothing is unconfirmed, or after RELOAD_SETTLE_MS with the rest
 * counted as unsure. Returns the function that starts the wait (after reset() has re-sent them).
 */
function watchUnsaved() {
  const u = { lost: 0, unsure: 0 };
  const offs = [
    store.on('reject', (r) => { if (!r.local) u.lost++; }),
    store.on('lost', ({ actions }) => { u.unsure += actions.length; }),
  ];
  return () => {
    reloading = true;
    const t0 = performance.now();
    const check = () => {
      const left = store.pending.length;
      if (left && performance.now() - t0 < RELOAD_SETTLE_MS) { setTimeout(check, 50); return; }
      for (const off of offs) off();
      noteUnsaved(unsavedMemo, { lost: u.lost, unsure: u.unsure + left });
      location.reload();
    };
    check();
  };
}

/** Everything except d/rej/ack (those are batched into the store). */
function handle(m) {
  if (m.t === MSG.MARK || m.t === MSG.EMOTE) {          // a short trail for tests and the F3 overlay
    const log = window.__hh.social;
    log.push({ t: m.t, pid: m.pid, id: m.id ?? null, kind: m.kind ?? null, x: m.x ?? null, z: m.z ?? null, at: Date.now() });
    if (log.length > 20) log.shift();
  }
  switch (m.t) {
    case MSG.WELCOME: return onWelcome(m);
    case MSG.SLOTS: return pickSlot(m.slots, Boolean(m.pass));
    case MSG.DENY:
      if (m.code === ERR.BAD_TOKEN) {
        if (ident.used) { delete ident.tokens[ident.used]; saveTokens(); ident.used = null; }
        return hello();
      }
      if (m.code === ERR.PROTO) { ui.toast(m.code); setTimeout(() => location.reload(), 1500); return undefined; }
      if (document.getElementById('slot-picker').hidden) { ident.name = null; return hello(); }
      return ui.slotError(m.code);
    case MSG.PRESENCE:
      peerTools.presence(m.list);
      syncPresent();
      return view.partner.update(m.list, m.ts);       // rows carry their own time (row[7]); m.ts is the batch time
    case MSG.PEER:
      peerTools.online(m.pid, m.online);
      syncPresent();
      // a farmer who left gets off the horse on this screen too (the last presence row still says 'horse')
      if (!m.online) view.avatars?.ride?.(m.pid, false);
      view.partner.online(m.pid, m.online);
      feedback?.peer(m.pid, m.online);
      return ui.setPeer(m.pid, m.online);
    case MSG.GHOST:
      return view.partner.ghost(m.pid, m.g);
    // The ui-shell's social corner draws relayed pings / emotes and captions them (ui.mark / ui.emote) when it is
    // wired; the feedback layer always plays the sound, and draws them itself otherwise.
    case MSG.MARK:
      if (typeof ui.mark === 'function') ui.mark(m.pid, { x: m.x, z: m.z, kind: m.kind });
      return feedback?.partnerPing(m.pid, m.x, m.z, { visual: typeof ui.mark !== 'function' });
    case MSG.EMOTE:
      if (typeof ui.emote === 'function') ui.emote(m.pid, m.id);
      return feedback?.partnerEmote(m.pid, m.id, { visual: typeof ui.emote !== 'function' });
    case MSG.CHAT:
      return typeof ui.chat === 'function' ? ui.chat(m) : undefined;
    default:
      return undefined;
  }
}

// ---- the per-frame inbox ----------------------------------------------------------------------------------
const inbox = [];
let inboxQueued = false;
let inboxTimer = null;
const isStoreMsg = (m) => m.t === MSG.DELTA || m.t === MSG.REJ || m.t === MSG.ACK;

function flushInbox() {
  if (!inboxQueued) return;
  inboxQueued = false;
  clearTimeout(inboxTimer);
  const list = inbox.splice(0);
  let run = [];
  const flushRun = () => { if (run.length) { store.onServerBatch(run); run = []; } };
  for (const m of list) {
    if (isStoreMsg(m)) { run.push(m); continue; }
    flushRun();
    try { handle(m); } catch (err) { console.error(`message ${m.t} failed`, err); }
  }
  flushRun();
}

function onMessage(m) {
  inbox.push(m);
  if (inboxQueued) return;
  inboxQueued = true;
  requestAnimationFrame(flushInbox);
  // no frame within 20 ms (a hidden tab, slow frames): flush anyway (qa2 SV-02: the 100 ms fallback was the playtest's
  // whole ack tail, p99 122-133 ms, on pages whose frames take longer than that); a real GPU's rAF still wins
  inboxTimer = setTimeout(flushInbox, 20);
}

// ---- audio: after the farm is up, or at the first gesture, whichever comes first (SV-05) -------------------------
// Fetching and decoding ~60 samples used to start before the renderer and competed with the first frame. The first
// pointer / key press starts it at once AND resumes the context inside that gesture (autoplay policy); otherwise it
// starts when the browser is idle after the first welcome.
let audioStarted = false;
function startAudio() {
  if (audioStarted) return;
  audioStarted = true;
  audio.init({ now: serverNow }).catch((err) => console.warn('audio init failed', err));
}
// iOS Safari starts audio only inside an activating gesture (touchend / pointerup / click, not touchstart): audio.js keeps
// listening for those after init, so a first touchstart creates the context and the same tap's touchend resumes it
const onFirstGesture = () => {
  for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, onFirstGesture, true);
  startAudio();
  audio.unlock();                                     // init created the context synchronously: resume it now
};
for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, onFirstGesture, { capture: true, passive: true });
function startAudioSoon() {
  const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 3000 }) : (fn) => setTimeout(fn, 300);
  setTimeout(() => idle(startAudio), 800);
}

async function boot() {
  const canvas = document.getElementById('world');
  // nobody touching the page for a while: the endless CSS pulses pause (CL-03, a resting laptop)
  window.__hh.rest = createRest();
  // the phone's visible area (iOS keyboard, orientation): CSS --vvh / --kb / data-orient for the layout (mobile wave)
  window.__hh.viewport = createViewport();
  // this page's build hash, when the server did not stamp index.html (SV-03; a failed fetch skips the check)
  if (!myBuild) {
    fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()).then((st) => { myBuild = pageBuild({ status: st }); })
      .catch(() => { /* unknown build: content hash only */ });
  }
  // ?quality=low|medium|high|eco|auto (tests, a slow partner PC); otherwise the view's default / remembered tier
  const q = ['low', 'medium', 'high', 'eco', 'auto'].includes(params.get('quality')) ? params.get('quality') : 'auto';
  // eco is the low tier plus capped frame rates: the renderer's MSAA is chosen at init, so init low, then eco (UI-16)
  await view.init(canvas, { quality: q === 'eco' ? 'low' : q, now: serverNow, overlay: document.getElementById('overlay') });
  if (q === 'eco') view.setQuality('eco');
  store.on('change', (ch) => view.sync(ch.ids, ch.topics));
  store.on('fx', ({ ev, by, local }) => view.fx.play(ev, undefined, feedback ? feedback.fxMeta(by, local) : { by, local }));
  store.on('lost', () => ui.notice('Some of your last actions may not have been saved. The farm shows what was.'));
  // Watchdog (review-m0 H3): a resync that gets no welcome within 5 s reconnects; the reconnect's hello is
  // always answered with a welcome. The store also repeats its request every RESYNC_RETRY_MS.
  let resyncT = null;
  store.on('resync', ({ cause }) => {
    console.warn('sync: resync requested:', cause);
    clearTimeout(resyncT);
    resyncT = setTimeout(() => { if (store.resyncing) socket.drop(); }, 5000);
  });
  store.on('welcome', () => clearTimeout(resyncT));
  // "Saving..." indicator: predictions unconfirmed for more than 1.2 s (a slow or stalled server) are worth a quiet
  // hint; on a LAN they confirm in 5-20 ms and nothing shows. The ui draws it (ui.setPending) when it has the hook.
  let pendingShown = false;
  setInterval(() => {
    if (typeof ui.setPending !== 'function' || !store.state) return;
    const hh = store.health();
    const show = hh.pending > 0 && hh.oldestMs > 1200;
    if (show || pendingShown) ui.setPending(show ? { n: hh.pending, oldestMs: hh.oldestMs, online: hh.online } : null);
    pendingShown = show;
  }, 400);
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  socket = new Socket({ url, clock, onMessage, onOpen: () => hello(),
    onStatus: (s) => { store.setOnline(s === 'open'); ui.setConnection(s); } });
  window.__hh.net = socket;
  socket.connect();
}

/** How much to trust the clock estimate: best RTT, the spread of the kept samples, a word for the overlay. */
function clockInfo() {
  const s = clock.samples;
  if (!s.length) return { rtt: clock.rtt, jitter: null, samples: 0, offset: clock.offset, quality: clock.offset === null ? 'none' : 'seeded' };
  const rtts = s.map((x) => x.rtt);
  const jitter = Math.max(...rtts) - Math.min(...rtts);
  const quality = clock.rtt < 30 && jitter < 25 ? 'good' : clock.rtt < 120 ? 'ok' : 'poor';
  return { rtt: Math.round(clock.rtt), jitter: Math.round(jitter), samples: s.length, offset: Math.round(clock.offset ?? 0), quality };
}

// Test and debug hook (tech §9.1): the E2E and shot tools drive the game through this.
window.__hh = {
  cid, store, view, ui, clock, audio, serverNow,
  act: (type, args) => store.act(type, args),
  get state() { return store.state; },
  get pending() { return store.pending.length; },
  get pid() { return store.pid; },
  health: () => store.health(),
  /** The last relayed pings / emotes received (newest last). */
  social: [],
  clockInfo,
  latency: () => (controller ? controller.latency() : null),
  dev: {
    /** HH_DEV servers only (loopback): jump game time, then re-sync the clock estimate. */
    async warp(ms) {
      const r = await fetch('/api/dev/warp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms }) });
      const { serverNow: target } = await r.json();
      for (let i = 0; i < 40 && serverNow() < target - 250; i++) {
        socket.ping();
        await new Promise((res) => setTimeout(res, 50));
      }
      view.invalidate();
      return serverNow();
    },
    /** Flush the inbox now (tests that must not wait for an animation frame). */
    flush: () => flushInbox(),
  },
};

// F3: debug overlay (fps, draw calls, RTT, clock quality, pending, latency, audio).
let debugEl = null;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F3') return;
  e.preventDefault();
  if (debugEl) { debugEl.remove(); debugEl = null; return; }
  debugEl = document.createElement('pre');
  debugEl.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.62);color:#fff;font:12px/1.35 monospace;border-radius:6px;pointer-events:none;z-index:9999';
  document.body.append(debugEl);
  // main-thread tasks over 50 ms in the last 10 s (qa2 CL-07: the partner laptop's numbers are read off this overlay)
  const long = [];
  let longObs = null;
  try {
    longObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push([e.startTime, e.duration]); });
    longObs.observe({ type: 'longtask', buffered: false });
  } catch { /* no long task timing in this browser */ }
  const tick = () => {
    if (!debugEl) { longObs?.disconnect(); return; }
    const t10 = performance.now() - 10_000;
    while (long.length && long[0][0] < t10) long.shift();
    const st = view.stats();
    const c = clockInfo();
    const hh = store.health();
    const l = controller ? controller.latency() : { n: 0 };
    const a = audio.info();
    debugEl.textContent = [
      `fps ${st.fps}  calls ${st.calls}  tris ${st.triangles}`,
      `tier ${st.tier ?? '-'}${st.tierMode === 'auto' ? ' (auto)' : ''}  band ${st.band ?? '-'}  shadows ${st.shadowRenders ?? '-'}  ${st.phase ?? ''} ${st.weather ?? ''} ${st.season ?? ''}`,
      `rtt ${c.rtt ?? '-'} ms  jitter ${c.jitter ?? '-'}  clock ${c.quality}  offset ${c.offset ?? '-'}`,
      `pending ${hh.pending}${hh.oldestMs ? ` (oldest ${hh.oldestMs} ms)` : ''}  v ${hh.v}  ${hh.online ? 'online' : `offline ${hh.offlineMs} ms`}${hh.resyncing ? '  RESYNC' : ''}  cid ${cid}`,
      `input->frame ${l.n ? `${l.last} ms (avg ${l.avg}, p95 ${l.p95}, n ${l.n})` : '-'}`,
      `long tasks (10 s) ${longObs ? `${long.length}${long.length ? `, max ${Math.round(Math.max(...long.map((x) => x[1])))} ms` : ''}` : 'n/a'}  rest ${window.__hh.rest?.resting ? 'resting' : 'awake'}`,
      `audio ${a.state} ${a.loaded} sounds  music ${a.music?.playing ? `${a.music.variant} bar ${a.music.bar}` : 'resting'}  ${a.scene.phase}`,
    ].join('\n');
    setTimeout(tick, 500);
  };
  tick();
});

boot().catch((err) => {
  console.error('boot failed', err);
  const p = document.createElement('p');
  p.style.cssText = 'position:fixed;top:40%;width:100%;text-align:center;font:600 18px system-ui';
  p.textContent = 'Harvest Hollow could not start (WebGL2 needed). Check the console.';
  document.body.append(p);
});
