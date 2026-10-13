// The job's shape and lifetimes (harness contract §4.2, §4.5). The privacy page states the two retention numbers;
// test/privacy-page.test.js ties them to these constants.
//
// Public Job (REST and `hx`): { id, by, provider, model, state, step, round, startedAt, updatedAt, lang, prompts,
// progress, result, error }. `priv` (farm key, parent version, fix rounds, timings, the isolation a binary offered)
// lives only in jobs/<id>/job.json on the farm's server.

/** A job folder's work/ and private/ are deleted this long after the job ended (job.json stays). */
export const JOB_FILES_KEEP_MS = 7 * 86_400_000;
/** A job's record (job.json, with its prompts) is deleted this long after its last change. */
export const JOB_RECORD_KEEP_MS = 30 * 86_400_000;
/** A ready candidate nobody applied or discarded expires after this long. */
export const READY_TTL_MS = 24 * 3_600_000;

export const ACTIVE = Object.freeze(['starting', 'working', 'validating', 'fixing', 'revising', 'applying']);
/** States that hold the farm's one job slot. */
export const OPEN = Object.freeze([...ACTIVE, 'ready']);
export const STEPS = Object.freeze(['reading', 'building', 'testing', 'fixing', 'ready', 'signin']);

/** The job as REST and `hx` show it (the private part never leaves the server). */
export function publicJob(job) {
  if (!job) return null;
  const { priv: _p, ...pub } = job;
  return pub;
}
