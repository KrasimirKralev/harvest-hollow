// The game's i18n entry (lane A): the engine (core.js), the content names (names.js) and every catalog area of the game
// (catalogs.js). UI code imports from here: import { t, tn, tNodes, fmtNum, N, Q } from '../i18n/index.js'.
// The landing page imports i18n/multi.js instead (its own area only).
import { register } from './core.js';
import { AREAS } from './catalogs.js';

for (const [area, en, bg] of AREAS) register(area, en, bg);

export * from './core.js';
export { name, qty, N, Q, gender, ctext, entry as nameEntry } from './names.js';
