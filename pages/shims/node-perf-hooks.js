// node:perf_hooks in a browser (pages/local-server.js): the page's own performance clock.
export const performance = globalThis.performance;
export function monitorEventLoopDelay() {
  return { enable() {}, disable() {}, reset() {}, percentile: () => 0, mean: 0, max: 0, min: 0, stddev: 0 };
}
export default { performance, monitorEventLoopDelay };
