// The way back in (area 'keep'): the engine plus that catalog only. ui/link-open.js and ui/qr-scan.js import this, as
// the landing page opens them on demand ("Already have a farm?"): a late area loads its Bulgarian at once (await
// loaded() before its first words). Inside the game i18n/index.js registers the same area (register() keeps the first).
import { register } from './core.js';
import keep from './en/keep.js';

register('keep', keep, () => import('./bg/keep.js'));

export * from './core.js';
