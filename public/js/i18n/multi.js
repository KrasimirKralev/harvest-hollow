// The multi-farm area on its own (lane A): the engine plus the 'multi' catalog only. The landing page
// (public/js/landing.js) and net/farm.js import this, so the front door never downloads the game's text; inside the
// game i18n/index.js registers the same area (register() keeps the first).
import { register } from './core.js';
import multi from './en/multi.js';

register('multi', multi, () => import('./bg/multi.js'));

export * from './core.js';
