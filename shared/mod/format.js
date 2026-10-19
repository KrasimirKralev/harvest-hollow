// Harness Hollow mod format 1 (docs/agent-notes/harness-contract.md §1): the closed vocabulary a farm's mod is written
// in. Everything the agent may choose is listed here; docs/mod-guide.md repeats it for the agent and
// test/mod.guide.test.js keeps the two in step. Pure data (shared/ purity rules).
//
//   FORMAT          the mod.json format number this build writes and reads (a newer server keeps reading 1)
//   ID_PREFIX/ID_RE a new id: 'x_' + [a-z0-9_]{1,30} (<= 32 chars, so it is also a content ID_RE id); the base content
//                   never uses the prefix, so a game update can never collide with a farm's mod
//   LIMITS          sizes and counts (bytes are UTF-8 JSON text)
//   LADDERS         the only durations a mod may pick: crop minutes, recipe minutes, tree cycle hours
//   VALUE_BP        humble / normal / rich in basis points
//   FILE_KINDS      the content families and the folder each lives in
//   SEASONS CROP_CLASSES YIELDS SKIES LETTER_FROM PALETTE_VARS TUNING_BP UNLOCK_RANGE   enums and ranges
//   REMOVED         knobs a NEW mod may no longer use (release 1.0, H2: they changed nothing on screen); a stored version
//                   that uses one still compiles, the knob ignored with a warning (M24, shared/mod/removed.js)

export const FORMAT = 1;
export const ID_PREFIX = 'x_';
export const ID_RE = /^x_[a-z0-9_]{1,30}$/;

export const LIMITS = Object.freeze({
  fileBytes: 16 * 1024,        // one file
  modBytes: 128 * 1024,        // the whole mod/ folder
  contentFiles: 40,            // content/<family>/<id>.json files
  newPerJob: 12,               // new things one job may add
  liveDefs: 60,                // live mod content defs on one farm
  versions: 200,               // stored versions per farm (older non-active ones are pruned)
  overlayBytes: 128 * 1024,    // the compiled overlay (it rides in the welcome)
  titleMax: 40,
  nameMin: 2,
  nameMax: 24,
  descMax: 80,
  letters: 3,
  letterTitleMax: 40,
  letterBodyMax: 600,
  tips: 10,
  tipMax: 140,
  inputsMin: 1,
  inputsMax: 4,
  inputQtyMax: 10,
  classesMin: 1,
  classesMax: 2,
  musicMin: 1,
  musicMax: 3,
});

export const LADDERS = Object.freeze({
  cropMin: Object.freeze([1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 960, 1440]),
  recipeMin: Object.freeze([5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]),
  treeHours: Object.freeze([3, 4, 6, 8, 10, 12, 16]),
});

export const VALUE_BP = Object.freeze({ humble: 9000, normal: 10000, rich: 11000 });

/** Content families a mod may add to, and the folder under mod/ that holds one file per new thing. */
export const FILE_KINDS = Object.freeze({
  crops: 'content/crops',
  trees: 'content/trees',
  recipes: 'content/recipes',
  animals: 'content/animals',
  decor: 'content/decor',
});
/** The other files a mod may have (mod.json is required). */
export const SINGLE_FILES = Object.freeze(['mod.json', 'tuning.json', 'look.json', 'text/letters.json']);
/** Files a version stored before 1.0 may still hold (read, recompiled, the removed knobs ignored). */
export const STORED_FILES = Object.freeze([...SINGLE_FILES, 'text/tips.json']);

export const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const CROP_CLASSES = Object.freeze(['grain', 'root', 'veg', 'fruit', 'cane', 'flower', 'fibre', 'bean', 'spice']);
export const YIELDS = Object.freeze([2, 3]);
export const UNLOCK_RANGE = Object.freeze([1, 40]);
export const SKIES = Object.freeze(['default', 'golden', 'pastel', 'cool', 'stormy']);
/** Who may write a letter: Grandma Hazel and the townsfolk (shared/content/npcs.js). */
export const LETTER_FROM = Object.freeze(['hazel', 'mabel', 'ollie', 'fern', 'juniper', 'reed', 'pemberton', 'pip',
  'rosie', 'tom', 'lucia']);
/** look.json palette keys of format 1 before 1.0 (read only from stored versions, never compiled: see REMOVED). */
export const PALETTE_VARS = Object.freeze({
  grass: '--grass-lit', leaf: '--leaf-mid', skyTop: '--sky-top', skyHorizon: '--sky-horizon', barn: '--barn-red',
});
/**
 * What a new mod may no longer use, and why (release 1.0, harvey#2: the palette's CSS variables and the tips reached no
 * pixel and no screen, so a change that "applied" them changed nothing). The schema answers UNSUPPORTED with the hint
 * for a new candidate; a stored version keeps compiling without them (compile.js warns IGNORED).
 */
export const REMOVED = Object.freeze({
  palette: Object.freeze({ file: 'look.json', path: 'palette', hint: 'colours of the barn, grass, leaves and sky cannot be '
    + 'changed yet: leave "palette" out and tell the player in summary.json; a new thing\'s own hue and a sky preset still work' }),
  tips: Object.freeze({ file: 'text/tips.json', path: '', hint: 'tips are not shown anywhere in the game yet: leave '
    + 'text/tips.json out (write it empty) and tell the player; a letter from a townsperson still works' }),
});

/** tuning.json *TimeBp / *CycleBp range (basis points of the normal time). */
export const TUNING_BP = Object.freeze([8000, 12500]);
export const TUNING_KEYS = Object.freeze(['growTimeBp', 'treeCycleBp', 'craftTimeBp', 'animalCycleBp']);
/** Things format 1 cannot change (their numbers live in frozen rule objects): the schema answers UNSUPPORTED. */
export const UNSUPPORTED_TUNING = Object.freeze(['events', 'crates', 'balloon', 'orders', 'weather', 'npcs', 'quests',
  'prices', 'xp', 'rewards']);

/** Problem codes by stage (each has a `harness.err.<CODE>` catalog line for the UI and a hint for the agent). */
export const CODES = Object.freeze({
  schema: Object.freeze(['BAD_JSON', 'UNKNOWN_FILE', 'UNKNOWN_FIELD', 'MISSING_FIELD', 'BAD_TYPE', 'BAD_ID', 'ID_TAKEN',
    'TOO_BIG', 'TOO_MANY', 'BAD_ENUM', 'NOT_LADDER', 'BAD_HEX', 'BAD_TEXT', 'UNSUPPORTED']),
  semantic: Object.freeze(['BAD_ANCHOR', 'UNKNOWN_REF', 'BAD_UNLOCK', 'OUT_OF_RANGE', 'ECON_BOUND', 'CYCLE', 'NAME_TAKEN',
    'LOW_CONTRAST', 'BG_FORMS', 'CONTENT_CHECK', 'NO_CHANGE', 'IGNORED']),
  boot: Object.freeze(['BOOT_THROW', 'ACTION_REJECTED', 'STATE_INVALID', 'ECON_GUARD', 'RETIRE_FAILED', 'TIMEOUT', 'OOM']),
  render: Object.freeze(['NO_MODEL', 'ICON_FAILED', 'NAME_TOO_LONG', 'COLOUR_FAR']),
});

/** The file path of a content family's thing. */
export const contentPath = (family, id) => `${FILE_KINDS[family]}/${id}.json`;

/** { family, id } of a content path, or null. */
export function parseContentPath(path) {
  if (typeof path !== 'string') return null;
  for (const [family, dir] of Object.entries(FILE_KINDS)) {
    if (path.startsWith(`${dir}/`) && path.endsWith('.json')) {
      const id = path.slice(dir.length + 1, -5);
      return { family, id };
    }
  }
  return null;
}
