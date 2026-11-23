// Release 1.0 (harvey#2, critique#1): the knobs format 1 took before 1.0 that a NEW mod may no longer use
// (format.js REMOVED: the palette's CSS variables and the tips reached no pixel and no screen). A stored version that
// uses one keeps compiling with the knob taken out (compile.js warns IGNORED), so the owners' mod is never suspended for
// it; the schema refuses it in a new candidate (UNSUPPORTED with the hint); the agent's work folder is seeded without
// it (server/agent/workspace.js), so the next change on such a farm does not trip over the old knob. Pure.
//
//   stripRemoved(files) -> { files, removed: [{ knob, file, path, hint }] }   a new files map (the input is unchanged)
import { REMOVED } from './format.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function stripRemoved(files) {
  const out = { ...(isObj(files) ? files : {}) };
  const removed = [];
  const note = (knob) => removed.push({ knob, file: REMOVED[knob].file, path: REMOVED[knob].path, hint: REMOVED[knob].hint });
  if (Object.hasOwn(out, REMOVED.tips.file)) {
    delete out[REMOVED.tips.file];
    note('tips');
  }
  const look = out[REMOVED.palette.file];
  if (isObj(look) && Object.hasOwn(look, 'palette')) {
    const { palette: _p, ...rest } = look;
    // a look.json that held only the palette says nothing any more: it goes too
    if (Object.keys(rest).length) out[REMOVED.palette.file] = rest;
    else delete out[REMOVED.palette.file];
    note('palette');
  }
  return { files: out, removed };
}
