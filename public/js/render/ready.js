// The first reveal (release 1.0, render-look G12; feel#4, astra#1): the view is "ready" once the models of what the
// camera sees first have loaded AND a frame has been drawn after that (so the reveal never shows grey placeholder
// boxes). ui-shell holds the painted boot curtain on view.ready({ timeoutMs }); the timeout means the curtain never hangs.
//
//   createReadyGate() -> gate
//     gate.models(promise)        the in-view model keys are loading (render/index.js passes models.ready(keys) at the
//                                 first state); a failed load counts as done (its placeholder stays)
//     gate.frame()                a frame was drawn (every rendered frame calls it; only one after the models counts)
//     gate.wait({ timeoutMs }) -> Promise<{ reason: 'ready' | 'timeout', ms }>   ms since the gate was made
//     gate.ready -> boolean
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createReadyGate() {
  const t0 = clock();
  let modelsDone = false;
  let done = null;
  const waiters = new Set();
  const finish = (reason) => {
    if (done) return;
    done = { reason, ms: Math.round(clock() - t0) };
    for (const w of waiters) w(done);
    waiters.clear();
  };
  return {
    models(p) {
      Promise.resolve(p).then(() => { modelsDone = true; }, () => { modelsDone = true; });
    },
    frame() { if (modelsDone) finish('ready'); },
    wait({ timeoutMs = 6000 } = {}) {
      if (done) return Promise.resolve(done);
      return new Promise((resolve) => {
        let timer = null;
        const w = (r) => { if (timer) clearTimeout(timer); resolve(r); };
        waiters.add(w);
        timer = setTimeout(() => { waiters.delete(w); resolve({ reason: 'timeout', ms: Math.round(clock() - t0) }); }, Math.max(0, timeoutMs));
      });
    },
    get ready() { return Boolean(done); },
  };
}
