// The server's entry script: `node server/index.js`. Everything else lives in app.js, and modules that need it
// (farms.js, farm-host.js, farm-worker.js) import app.js, never this file. Why: the live service runs
// `node --preserve-symlinks-main ~/harvest-hollow-live/server/index.js`, so this module keeps its symlink URL while
// every import resolves to its real path; a module importing the entry got a second copy of it whose own entry check
// passed, and the server started twice (EADDRINUSE on a fixed port; seen on the live box 2026-10-13).
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { isEntry, main } from './app.js';

export * from './app.js';

if (isMainThread && isEntry(process.argv[1], fileURLToPath(import.meta.url))) main();
