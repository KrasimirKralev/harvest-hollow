// The in-game helper's words (area 'harness'): registered only when the helper's screens load (ui/harness/boot.js), so
// a game whose server offers no helper never loads them. Await loaded() before the first word (Bulgarian is lazy).
import { register } from './core.js';
import harness from './en/harness.js';

register('harness', harness, () => import('./bg/harness.js'));

export * from './core.js';
