// A round belongs to the open picnic panel. The shared farm keeps running in the background.
import { h, icon } from '../dom.js';
import { t, name, register, loaded } from '../../i18n/index.js';

import english from '../../i18n/en/picnic.js';

register('picnic', english, () => import('../../i18n/bg/picnic.js'));
export async function loadPicnic() {
  await loaded();
  return picnicPanel;
}

const food = ['apple', 'strawberry', 'carrot', 'egg', 'bread', 'honey'];

function deal() {
  const cards = [...food, ...food];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export const picnicPanel = {
  mount(body) {
    const board = h('div.picnic-grid', {role: 'group', 'aria-label': t('hud.picnic.title')});
    const status = h('p.picnic-status', {role: 'status', 'aria-live': 'polite'});
    const replay = h('button.btn', {type: 'button', hidden: true, on: {click: () => start(true)}}, t('picnic.again'));
    body.append(h('div.picnic-table', h('p.picnic-how', t('picnic.how')), board, status, replay));
    let first, matches, turns, timer;

    function start(focus = false) {
      clearTimeout(timer);
      timer = null;
      first = null;
      matches = turns = 0;
      replay.hidden = true;
      const cards = deal().map((id, i) => {
        const back = t('picnic.card', {n: i + 1});
        const button = h('button.picnic-card', {type: 'button', 'aria-label': back});
        button.addEventListener('click', () => reveal(button, id, back));
        return button;
      });
      board.replaceChildren(...cards);
      progress();
      if (focus) cards[0].focus();
    }

    function progress() {
      status.textContent = t(matches === food.length ? 'picnic.win' : 'picnic.score', {pairs: matches, turns});
    }

    function reveal(button, id, back) {
      if (timer || button.dataset.face) return;
      button.dataset.face = 'up';
      button.setAttribute('aria-label', name(id));
      button.append(icon(id, {size: 48}));
      if (!first) {
        first = {button, id, back};
        return;
      }
      const previous = first;
      first = null;
      turns++;
      if (previous.id === id) {
        for (const card of [previous.button, button]) {
          card.dataset.face = 'matched';
          card.setAttribute('aria-label', t('picnic.packed', {food: name(id)}));
          card.setAttribute('aria-disabled', 'true');
        }
        matches++;
        if (matches === food.length) replay.hidden = false;
      } else {
        timer = setTimeout(() => {
          for (const [card, label] of [[button, back], [previous.button, previous.back]]) {
            delete card.dataset.face;
            card.replaceChildren();
            card.setAttribute('aria-label', label);
          }
          timer = null;
        }, 1000);
      }
      progress();
    }

    start();
    return {destroy() { clearTimeout(timer); }};
  },
};
