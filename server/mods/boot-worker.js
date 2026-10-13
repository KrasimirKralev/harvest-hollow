// The boot test's worker thread (contract §3 stage 3): its own module graph, so the candidate overlay it installs never
// touches the farm's process. One task per worker: { overlay, state, now, full } -> the bootTest() result.
import { parentPort, workerData } from 'node:worker_threads';
import { bootTest } from './boot.js';

const run = (task) => {
  try {
    return bootTest(task);
  } catch (err) {
    return { ok: false, errors: [{ stage: 'boot', code: 'BOOT_THROW', file: '', path: '', message: String(err && err.message).slice(0, 300) }], checks: { ok: false } };
  }
};

if (workerData && workerData.task) parentPort.postMessage(run(workerData.task));
else parentPort.on('message', (task) => parentPort.postMessage(run(task)));
