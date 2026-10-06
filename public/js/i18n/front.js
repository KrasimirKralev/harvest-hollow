// The landing page's own words (area 'front'): the engine plus that catalog only. js/landing.js, front/ideas.js and
// front/gallery.js import this, so the front door never downloads the game's text (net/farm.js brings the 'multi' area:
// the page's title and description); inside the game i18n/index.js registers the same area (register() keeps the first).
import { register } from './core.js';
import front from './en/front.js';

register('front', front, () => import('./bg/front.js'));

export * from './core.js';
