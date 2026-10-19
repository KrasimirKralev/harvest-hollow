// The files of other lanes that infra's two guard tests still report instead of failing on (release 1.0): the static-URL
// scan (test/rel-infra.client-asset-urls.scan.test.js) and the name scrub (test/rel-infra.name-scrub.test.js). Each
// entry is file -> [owner, the count at HEAD fdafb9c]; a file may only go down, and it leaves its list as soon as it is
// clean (strict from then on). infra checks both lists every hour against the other lanes' notes. Not a test file.

/**
 * Files of other lanes with sites left at HEAD fdafb9c: file -> [owner, the number of sites then]. A file may only go
 * down; a clean file leaves the list. infra checks the list every hour (docs/agent-notes/rel-infra.md).
 */
// every lane's sites routed by 2026-10-14 04:00: strict for every file
export const ASSET_PENDING = new Map([]);

/**
 * Files of other lanes still being scrubbed in this wave (release-scope §6 table): file -> [owner, the number of
 * matching lines at HEAD fdafb9c]. A pending file may only go DOWN (a new name in it fails at once); a file that is
 * clean leaves this list (infra checks every hour), and from then on it is strict like every other file.
 */
// every file scrubbed by 2026-10-14 04:00: strict for every file
export const NAME_PENDING = new Map([]);
