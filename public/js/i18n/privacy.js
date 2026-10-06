// The privacy page's words (area 'privacy'): the engine plus that catalog only. js/privacy.js (public/privacy.html, whose
// articles carry both languages) imports this for its form's words and its title; inside the game i18n/index.js
// registers the same area (register() keeps the first).
import { register } from './core.js';
import privacy from './en/privacy.js';

register('privacy', privacy, () => import('./bg/privacy.js'));

export * from './core.js';
