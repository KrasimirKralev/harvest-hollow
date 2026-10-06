// Every catalog area of the game, one English module (the source, loaded with the page) and one Bulgarian module
// (loaded only when Bulgarian is chosen) per area. One area = one lane's files, so two lanes never edit the same catalog
// (docs/agent-notes/i18n-core.md "Areas"). Lane A owns this list; every lane's areas are already in it: a lane fills
// its own en/<area>.js and bg/<area>.js and never needs to touch this file. Literal import() lines on purpose: the
// server versions every module it can find (server/static.js), and finds only literal specifiers.
import core from './en/core.js';
import shell from './en/shell.js';
import hud from './en/hud.js';
import toolbar from './en/toolbar.js';
import toasts from './en/toasts.js';
import moments from './en/moments.js';
import settings from './en/settings.js';
import social from './en/social.js';
import game from './en/game.js';
import multi from './en/multi.js';
import league from './en/league.js';
import weekly from './en/weekly.js';
import feed from './en/feed.js';
import goals from './en/goals.js';
import market from './en/market.js';
import farm from './en/farm.js';
import collect from './en/collect.js';
import home from './en/home.js';
import keep from './en/keep.js';
import privacy from './en/privacy.js';
import front from './en/front.js';

/** [area, English catalog, Bulgarian loader] in load order. */
export const AREAS = [
  // lane A: core and shell
  ['core', core, () => import('./bg/core.js')],
  ['shell', shell, () => import('./bg/shell.js')],
  ['hud', hud, () => import('./bg/hud.js')],
  ['toolbar', toolbar, () => import('./bg/toolbar.js')],
  ['toasts', toasts, () => import('./bg/toasts.js')],
  ['moments', moments, () => import('./bg/moments.js')],
  ['settings', settings, () => import('./bg/settings.js')],
  ['social', social, () => import('./bg/social.js')],
  ['game', game, () => import('./bg/game.js')],
  ['multi', multi, () => import('./bg/multi.js')],
  // lane B: league and weekly panels (the content names table is i18n/bg/names.js)
  ['league', league, () => import('./bg/league.js')],
  ['weekly', weekly, () => import('./bg/weekly.js')],
  // lane C: feed, Journal, goals and quests
  ['feed', feed, () => import('./bg/feed.js')],
  ['goals', goals, () => import('./bg/goals.js')],
  // lane D: economy, collect and home panels
  ['market', market, () => import('./bg/market.js')],
  ['farm', farm, () => import('./bg/farm.js')],
  ['collect', collect, () => import('./bg/collect.js')],
  ['home', home, () => import('./bg/home.js')],
  // multi-farm hosting: the keys (a lost device's way back), privacy, and the landing page's words (also the game's
  // ideas card and star card). 'keep' and 'front' are also registered on their own (i18n/keep.js, i18n/front.js) by
  // the modules the landing page shares: register() keeps the first.
  ['keep', keep, () => import('./bg/keep.js')],
  ['privacy', privacy, () => import('./bg/privacy.js')],
  ['front', front, () => import('./bg/front.js')],
];
