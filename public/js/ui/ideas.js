// "Suggest an idea" in the game (owner request 2026-10-05: "people can give ideas for implementations, so we can
// gather them, review later and maybe merge them"). One entry in the More menu (desktop), the farm menu (phones) and
// Settings > Farm. A hosted farm (multi mode) opens a card with the ideas form (front/ideas.js; its farm id rides
// along); a self-hosted single farm has no ideas box of its own, so the same entry opens the GitHub Discussions ideas
// category in a new tab.
//
//   createIdeasUi(S) -> { open(), menuItem(closeMenu), tile(closeSheet), settingsRows(ctx), multi }
//     menuItem / tile build the entry for ui/hud.js's More menu and ui/layout.js's farm menu (their classes, their roles)
import { h, svgIcon, ensureStylesheet } from './dom.js';
import { farm } from '../net/farm.js';
import { t } from '../i18n/index.js';
import { IDEAS_URL } from '../front/links.js';

export function createIdeasUi(S) {
  const { ui } = S;
  const multi = farm.multi;
  let form = null;            // the last ideas form built (its draft survives a language switch)
  if (multi) {
    ui.panels.register('ideas', {
      get title() { return t('front.game.suggest'); },
      size: 'card',
      mount(body) {
        ensureStylesheet('/css/ideas.css');
        const wrap = h('div.ideas-card', h('p.ideas-lead', t('front.game.ideasLead')));
        body.append(wrap);
        // the form's code comes with the first open: nobody pays for it at boot. A language switch mounts the card again:
        // the new form starts from what the last one held
        import('../front/ideas.js').then(({ ideaForm }) => {
          if (!wrap.isConnected) return;
          const f = ideaForm({ prefix: 'game-idea', farm: farm.id, draft: form?.draft() ?? null });
          form = f;
          wrap.append(f.el);
          f.focus();
        }).catch((err) => {
          console.error('ideas form failed to load', err);
          if (wrap.isConnected) wrap.append(h('p.idea-alt', h('a', { href: IDEAS_URL, target: '_blank', rel: 'noopener' }, t('front.ideas.github'))));
        });
      },
    });
  }

  function open() {
    if (multi) { ui.panels.open('ideas'); return; }
    globalThis.open?.(IDEAS_URL, '_blank', 'noopener');
  }

  /** The More menu's item (hud.js), closing that menu first. */
  const menuItem = (closeMenu) => h('button.edge-item', { type: 'button', role: 'menuitem', id: 'hud-ideas', dataset: { mk: 'front.game.suggest' },
    on: { click: () => { closeMenu?.(); open(); } } }, svgIcon('sprout', 26), h('span.lbl', t('front.game.suggest')));

  /** The phone farm menu's tile (layout.js): a short label, the whole words for a screen reader. */
  const tile = (closeSheet) => h('button.m-tile', { type: 'button', 'aria-label': t('front.game.suggest'), dataset: { ideas: 'open' },
    on: { click: () => { closeSheet?.(); open(); } } }, h('span.m-ico', svgIcon('sprout', 30)), h('span.lbl', t('front.game.ideasTile')));

  /** Settings > Farm. */
  const settingsRows = (ctx) => [
    h('div.set-row', h('span.lbl', t('front.game.ideasRow')), h('div',
      h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { ideas: 'open' }, on: { click: () => { ctx.close(); open(); } } }, t('front.game.suggest'))),
    h('span.help', t(multi ? 'front.game.ideasHelp' : 'front.game.ideasHelpGithub'))),
  ];

  return { open, menuItem, tile, settingsRows, multi };
}
