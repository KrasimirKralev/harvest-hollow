// The six agent tools (harness contract §5.4), implemented once for every provider. ChatGPT calls them as function
// tools; the mock provider calls them directly; Claude Code uses its own Read/Glob/Grep/Write/Edit (scoped by its
// settings) and reaches `validate`/`preview` through server/agent/mcp-bridge.mjs.
//
// Paths are relative to the job's `work/` folder. Refused (`BAD_PATH`): absolute paths, `..`, NUL, backslashes and
// any symlink on the way. Writes go only to the mod files of format 1 and `summary.json`; an EMPTY content removes a
// mod file (that is how an agent retires something: the tools have no delete). Every answer is a plain object; a
// refusal is `{ error: { code, message } }` and never throws, so a confused model gets a reason, not a crash.
import fsp from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = Object.freeze({
  readBytes: 256 * 1024,       // read_file
  fileBytes: 16 * 1024,        // one mod file / summary.json
  modBytes: 128 * 1024,        // the whole mod/ folder
  modFiles: 60,                // files under mod/ (40 content files + the rest, the schema checks the exact count)
  listMax: 500,                // list_files entries
  validateCalls: 8,            // validate calls per round
  errorsShown: 30,             // errors in a validate answer
});

const ID = 'x_[a-z0-9_]{1,30}';
/** The paths format 1 knows (contract §1.1), relative to work/. */
export const WRITABLE = new RegExp(`^(?:summary\\.json|mod/(?:mod\\.json|tuning\\.json|look\\.json|text/letters\\.json`
  + `|text/tips\\.json|content/(?:crops|trees|recipes|animals|decor)/${ID}\\.json))$`);

const fail = (code, message) => ({ error: { code, message } });

/** A tool refusal carried up through helpers. */
class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Resolve a work-relative path safely. Throws ToolError('BAD_PATH').
 * @param {string} workDir absolute
 * @param {unknown} rel
 */
export async function safePath(workDir, rel) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 200) throw new ToolError('BAD_PATH', 'path must be a short relative path');
  if (rel.includes('\0') || rel.includes('\\') || path.posix.isAbsolute(rel) || /^[a-z]:/i.test(rel)) {
    throw new ToolError('BAD_PATH', 'only relative paths inside the job folder');
  }
  const parts = rel.split('/');
  if (parts.includes('..')) throw new ToolError('BAD_PATH', '".." is not allowed');
  const norm = path.posix.normalize(rel).replace(/^\.\/+/, '').replace(/\/+$/, '');
  const full = norm === '.' || norm === '' ? workDir : path.join(workDir, norm);
  if (full !== workDir && !full.startsWith(workDir + path.sep)) throw new ToolError('BAD_PATH', 'outside the job folder');
  // no symlink anywhere between work/ and the target (a link planted in work/ must not lead out of it)
  let cur = workDir;
  for (const seg of norm === '.' || norm === '' ? [] : norm.split('/')) {
    cur = path.join(cur, seg);
    let st = null;
    try { st = await fsp.lstat(cur); } catch { break; }
    if (st.isSymbolicLink()) throw new ToolError('BAD_PATH', 'links are not followed');
  }
  return { full, rel: norm === '' ? '.' : norm };
}

/** Every regular file under `dir` (absolute), as [{ rel, full, size }] relative to `base`; links are skipped. */
export async function walk(dir, base, max = Infinity) {
  const out = [];
  const visit = async (d) => {
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (out.length >= max) return;
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) await visit(full);
      else if (e.isFile()) {
        const st = await fsp.lstat(full);
        out.push({ rel: path.relative(base, full).split(path.sep).join('/'), full, size: st.size });
      }
    }
  };
  await visit(dir);
  return out;
}

const problem = (code, file, message, hint) => ({ stage: 'schema', code, file, path: '', message, ...(hint ? { hint } : {}) });

/**
 * Read the agent's mod folder into the parsed files map the mods lane validates (`{ 'mod.json': obj, ... }`, paths
 * relative to mod/). Files the map cannot carry come back as schema problems: not JSON (`BAD_JSON`), not a .json
 * file or a link (`UNKNOWN_FILE`), too big (`TOO_BIG`). An empty file is a removed file (see WRITABLE).
 * @param {string} workDir
 * @returns {Promise<{ files: Record<string, unknown>, problems: object[], bytes: number }>}
 */
export async function readModFiles(workDir) {
  const modDir = path.join(workDir, 'mod');
  const files = {};
  const problems = [];
  let bytes = 0;
  let entries = [];
  try { entries = await fsp.readdir(modDir, { recursive: true, withFileTypes: true }); } catch { entries = []; }
  const list = [];
  for (const e of entries) {
    const full = path.join(e.parentPath ?? e.path, e.name);
    const rel = path.relative(modDir, full).split(path.sep).join('/');
    if (e.isSymbolicLink()) { problems.push(problem('UNKNOWN_FILE', rel, 'links are not allowed in a mod')); continue; }
    if (e.isFile()) list.push({ rel, full });
  }
  list.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  for (const { rel, full } of list) {
    const raw = await fsp.readFile(full);
    if (raw.toString('utf8').trim() === '') continue;            // an emptied file = removed (retired)
    bytes += raw.length;
    if (!rel.endsWith('.json')) { problems.push(problem('UNKNOWN_FILE', rel, 'only the .json files of the guide belong in mod/')); continue; }
    if (raw.length > LIMITS.fileBytes) { problems.push(problem('TOO_BIG', rel, `a file may hold ${LIMITS.fileBytes} bytes`)); continue; }
    try {
      files[rel] = JSON.parse(raw.toString('utf8'));
    } catch (err) {
      problems.push(problem('BAD_JSON', rel, `not valid JSON: ${String(err.message).slice(0, 120)}`, 'write one JSON value, double quotes, no comments or trailing commas'));
    }
  }
  if (bytes > LIMITS.modBytes) problems.push(problem('TOO_BIG', '', `the mod folder may hold ${LIMITS.modBytes} bytes`));
  return { files, problems, bytes };
}

/** A failed ValidationResult made from the lane's own pre-checks (the files never reached the validator). */
export function precheckResult(problems, { full = false, ms = 0 } = {}) {
  return { ok: false, stage: 'schema', full, ms, modHash: null, overlayHash: null, errors: problems, warnings: [],
    checks: { schema: { ok: false, files: 0 } } };
}

/** The compact validate answer for the agent: the verdict, at most 30 errors, warnings and the derived numbers. */
export function compactResult(v) {
  const pick = (e) => ({ code: e.code, file: e.file, path: e.path, message: e.message, ...(e.hint ? { hint: e.hint } : {}) });
  const errors = Array.isArray(v && v.errors) ? v.errors : [];
  const warnings = Array.isArray(v && v.warnings) ? v.warnings : [];
  return {
    ok: Boolean(v && v.ok),
    stage: v ? v.stage : 'schema',
    errors: errors.slice(0, LIMITS.errorsShown).map(pick),
    ...(errors.length > LIMITS.errorsShown ? { moreErrors: errors.length - LIMITS.errorsShown } : {}),
    warnings: warnings.slice(0, 10).map(pick),
    numbers: (v && v.checks && v.checks.semantic && v.checks.semantic.numbers) || {},
  };
}

/** JSON schemas of the six tools (strict function tools for ChatGPT; the mock reads the same names). */
export const TOOL_SPECS = Object.freeze([
  { name: 'read_file', description: 'Read a text file under the job folder (request.md, docs/..., mod/..., summary.json).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'relative path, e.g. docs/mod-guide.md' } },
      required: ['path'], additionalProperties: false } },
  { name: 'list_files', description: 'List the files under a folder of the job folder (the whole folder when dir is null).',
    parameters: { type: 'object', properties: { dir: { type: ['string', 'null'], description: 'relative folder or null' } },
      required: ['dir'], additionalProperties: false } },
  { name: 'write_file', description: 'Write a whole file: only mod/... files of the guide and summary.json, at most 16 KB. '
      + 'Empty content removes a mod file (that retires the thing it defined).',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'], additionalProperties: false } },
  { name: 'edit_file', description: 'Replace one exact occurrence of `old` with `new` in a mod/... file or summary.json.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
      required: ['path', 'old', 'new'], additionalProperties: false } },
  { name: 'validate', description: 'Check the mod: schema, meaning and a quick play test on a copy of the farm. Returns ok, errors (file, path, code, hint), warnings and the computed numbers.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'preview', description: 'What the player will see: the things added, changed or retired, with names and numbers.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
]);

/**
 * @param {{ workDir: string, validate: (files: object) => Promise<object>, preview: (files: object) => Promise<object>,
 *   onEvent?: (ev: { type: 'tool', name: string, path?: string }) => void }} o
 */
export function createTools({ workDir, validate, preview, onEvent = () => {} }) {
  let validateCalls = 0;
  let previewCalls = 0;
  const guard = (name, fn) => async (args = {}) => {
    try {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) return fail('BAD_ARGS', 'arguments must be an object');
      return await fn(args);
    } catch (err) {
      if (err instanceof ToolError) return fail(err.code, err.message);
      if (err && err.code === 'ENOENT') return fail('NOT_FOUND', 'no such file');
      if (err && err.code === 'EISDIR') return fail('BAD_PATH', 'that is a folder');
      return fail('INTERNAL', `${name} failed`);
    }
  };

  const modBytesAfter = async (rel, size) => {
    const files = await walk(path.join(workDir, 'mod'), workDir);
    let total = size;
    for (const f of files) if (f.rel !== rel) total += f.size;
    return { total, count: files.filter((f) => f.rel !== rel).length + (size > 0 ? 1 : 0) };
  };

  const write = async (rel0, content) => {
    if (typeof content !== 'string') throw new ToolError('BAD_ARGS', 'content must be a string');
    const { full, rel } = await safePath(workDir, rel0);
    if (!WRITABLE.test(rel)) {
      throw new ToolError('NOT_ALLOWED', 'you may write only mod/ files of the guide (mod/mod.json, mod/content/<family>/x_<id>.json, '
        + 'mod/tuning.json, mod/look.json, mod/text/letters.json, mod/text/tips.json) and summary.json');
    }
    const size = Buffer.byteLength(content, 'utf8');
    if (size > LIMITS.fileBytes) throw new ToolError('TOO_BIG', `a file may hold ${LIMITS.fileBytes} bytes`);
    if (rel.startsWith('mod/')) {
      const { total, count } = await modBytesAfter(rel, size);
      if (total > LIMITS.modBytes) throw new ToolError('TOO_BIG', `the mod folder may hold ${LIMITS.modBytes} bytes`);
      if (count > LIMITS.modFiles) throw new ToolError('TOO_BIG', 'too many files in mod/');
    }
    if (content.trim() === '' && rel.startsWith('mod/')) {
      await fsp.rm(full, { force: true });
      return { ok: true, removed: true };
    }
    await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    // a link created at the target between the check and the write must not be followed
    try { if ((await fsp.lstat(full)).isSymbolicLink()) throw new ToolError('BAD_PATH', 'links are not followed'); } catch (err) {
      if (err instanceof ToolError) throw err;
    }
    await fsp.writeFile(full, content, { mode: 0o600 });
    return { ok: true };
  };

  return {
    read_file: guard('read_file', async ({ path: rel0 }) => {
      const { full, rel } = await safePath(workDir, rel0);
      onEvent({ type: 'tool', name: 'read_file', path: rel });
      const st = await fsp.lstat(full);
      if (!st.isFile()) throw new ToolError('BAD_PATH', 'not a file');
      if (st.size > LIMITS.readBytes) throw new ToolError('TOO_BIG', `files over ${LIMITS.readBytes} bytes are not read`);
      return { content: await fsp.readFile(full, 'utf8') };
    }),
    list_files: guard('list_files', async ({ dir }) => {
      const { full, rel } = await safePath(workDir, dir === undefined || dir === null || dir === '' ? '.' : dir);
      onEvent({ type: 'tool', name: 'list_files', path: rel });
      const files = await walk(full, workDir, LIMITS.listMax);
      return { files: files.map((f) => ({ path: f.rel, size: f.size })) };
    }),
    write_file: guard('write_file', async ({ path: rel, content }) => {
      const out = await write(rel, content);
      onEvent({ type: 'tool', name: 'write_file', path: String(rel) });
      return out;
    }),
    edit_file: guard('edit_file', async ({ path: rel0, old, new: next }) => {
      if (typeof old !== 'string' || old === '' || typeof next !== 'string') throw new ToolError('BAD_ARGS', 'old must be a non-empty string and new a string');
      const { full, rel } = await safePath(workDir, rel0);
      if (!WRITABLE.test(rel)) throw new ToolError('NOT_ALLOWED', 'you may edit only mod/ files of the guide and summary.json');
      const text = await fsp.readFile(full, 'utf8');
      const at = text.indexOf(old);
      if (at < 0) throw new ToolError('NOT_FOUND', '`old` does not occur in the file');
      if (text.indexOf(old, at + old.length) >= 0) throw new ToolError('NOT_UNIQUE', '`old` occurs more than once; include more context');
      await write(rel, text.slice(0, at) + next + text.slice(at + old.length));
      onEvent({ type: 'tool', name: 'edit_file', path: rel });
      return { ok: true, replaced: 1 };
    }),
    validate: guard('validate', async () => {
      if (++validateCalls > LIMITS.validateCalls) {
        throw new ToolError('LIMIT', `validate may run ${LIMITS.validateCalls} times a round; write summary.json and stop`);
      }
      onEvent({ type: 'tool', name: 'validate' });
      const { files, problems } = await readModFiles(workDir);
      return compactResult(problems.length ? precheckResult(problems) : await validate(files));
    }),
    preview: guard('preview', async () => {
      if (++previewCalls > LIMITS.validateCalls) throw new ToolError('LIMIT', 'preview was called too often');
      onEvent({ type: 'tool', name: 'preview' });
      const { files, problems } = await readModFiles(workDir);
      if (problems.length) return { error: { code: 'INVALID', message: 'fix the files validate reports first' } };
      return await preview(files);
    }),
  };
}

export { ToolError };
