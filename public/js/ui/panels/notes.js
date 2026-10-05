// The notes board (GDD §6.2 #2, §7.3 "Notes"): little paper notes the two of you pin to a spot on the farm, so the
// partner who plays later finds them. Write one (140 characters, pinned where you stand), read them in the
// partner's colour, "Show me" eases the camera to the spot, and either of you can take a note down.
import { COOP } from '../../../../shared/content/index.js';
import { START } from '../../../../shared/content/config.js';
import { spawnAt } from '../../../../shared/rules/grid.js';
import { h, svgIcon, fmt, createKit, empty, who, ago } from './kit.js';
import { I } from './intents.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

/** The tile I stand on: my avatar's pose (float tiles), else my slot's spawn point at the porch. */
export function myTile(ctx) {
  const pid = ctx.store.pid;
  let p = null;
  try { p = ctx.view?.partner?.pose ? ctx.view.partner.pose(pid) : null; } catch { p = null; }
  // no pose yet: the porch, wherever the farmhouse stands now (the landmarks move since 2026-10-04)
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) p = ctx.store.state ? spawnAt(ctx.store.state, pid) : (START.spawn && START.spawn[pid]) || { x: 20, z: 28 };
  return { x: Math.max(0, Math.min(63, Math.floor(p.x))), z: Math.max(0, Math.min(63, Math.floor(p.z))) };
}

export const notesPanel = {
  title: 'Notes',
  icon: null,
  size: 'side',
  topics: ['notes', 'players'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let draft = '';
    const max = COOP.notes.maxChars;
    const area = h('textarea.pn-input.pn-note-input', { maxlength: String(max), rows: '3', placeholder: 'A note for your partner…',
      'aria-label': 'Write a note', on: { input: (e) => { draft = e.target.value; count.textContent = `${fmt(draft.length)}/${max}`; kit.refresh(); } } });
    const count = h('small.pn-note-count', `0/${max}`);
    const post = kit.button({ label: 'Pin it here', glyph: 'ping', cls: 'pn-sm', data: { note: 'post' },
      ...lazy(() => { const t = myTile(ctx); return I.postNote(draft.trim() || ' ', t.x, t.z); }),
      // the reason is said, not hidden: an empty box is the one thing standing between the player and the pin (UI-28)
      gate: () => (draft.trim() ? null : { code: 'EMPTY', hint: { text: 'Write a note first' } }),
      hint: { cap: COOP.notes.maxOpen },
      after: (r) => { if (r && r.ok) { draft = ''; area.value = ''; count.textContent = `0/${max}`; } } });
    const list = h('div.pn-notes');
    body.append(h('div.pn-compose', area, h('div.pn-compose-foot', count, post)), list);

    const up = kit.memo(list, () => [ctx.store.state.farm.notes ?? {}], () => {
      const st = ctx.store.state;
      const notes = Object.entries(st.farm.notes ?? {}).sort((a, b) => b[1].at - a[1].at || (a[0] < b[0] ? -1 : 1));
      list.replaceChildren();
      if (!notes.length) { list.append(empty('No notes yet. Leave one for the next time your partner plays!', 'note')); return; }
      notes.forEach(([id, n], i) => {
        const p = st.players[n.by];
        list.append(h('article.pn-note', { style: { '--who': p?.color ?? '#B9A27A', '--tilt': `${[-1.4, 1, -0.6, 1.3][i % 4]}deg` }, dataset: { note: id } },
          h('span.pn-note-pin', { 'aria-hidden': 'true' }),
          h('p.pn-note-text', n.text),
          h('footer', who(st, n.by, { me: ctx.store.pid }), h('small', ago(ctx.now() - n.at)),
            typeof ctx.view?.focus === 'function' ? h('button.pn-chipbtn', { type: 'button', title: `Tile ${n.x}, ${n.z}`,
              on: { click: () => { ctx.view.focus(n.x, n.z); ctx.close(); } } }, svgIcon('ping', 14), 'Show me') : null,
            kit.button({ label: '×', cls: 'pn-xs pn-ghost', title: 'Take the note down', ...lazy(() => I.removeNote(id)), data: { unnote: id } }))));
      });
      kit.refresh();
    });
    up(true);
    // opened from a note on the farm (the Hand on its paper slip, RD-30): ring that note for 2 s
    const want = ctx.args && ctx.args.id;
    if (want) {
      requestAnimationFrame(() => {
        const el = list.querySelector(`[data-note="${CSS.escape(String(want))}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('pn-focus-ring');
        setTimeout(() => el.classList.remove('pn-focus-ring'), 2000);
      });
    }
    return { update: () => up() };
  },
};
