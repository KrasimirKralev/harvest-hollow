// QA r1 L-03 (ap#4, scope F6a): an untouched farm must not keep the render loop at the interactive rate. The animals'
// idle hops (a playful animal's or an alpaca's pronk) are ambient motion that travels (WANT.MOVING: the loop's calm
// rate, 6 fps after two minutes), never the interactive frame (2), which also starts the loop's 2 s 60 fps tail. A pet
// or a happy jig after a collect is caused by the player and stays interactive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFxDom } from './helpers/life-feel.js';

installFxDom();
const THREE = await import('three');
const { makeFarm, T0 } = await import('./helpers.js');
const { createAnimalsView } = await import('../public/js/render/animals-view.js');
const { WANT } = await import('../public/js/render/renderer.js');

/** A paddock of four playful alpacas (they pronk now and then when idle), fed and producing. */
function farm() {
  const st = makeFarm();
  st.farm.objects.pd = { def: 'paddock', x: 40, z: 40, rot: 0, placedAt: T0 - 1e7 };
  for (let i = 0; i < 4; i++) {
    st.farm.objects[`al${i}`] = { def: 'alpaca', home: 'pd', bornAt: T0 - 1e8, adultAt: T0 - 1e7, fedAt: T0 - 1000,
      readyAt: T0 + 3.6e6, pers: 'playful' };
  }
  return st;
}

function run(view, clock, seconds, dt = 1 / 30) {
  const wants = new Map();
  for (let i = 0; i < seconds / dt; i++) {
    clock.now += dt * 1000;
    const w = view.update(dt);
    wants.set(w, (wants.get(w) ?? 0) + 1);
  }
  return wants;
}

test('L-03: two idle minutes of playful animals never ask for the interactive frame (their hops are ambient motion)', () => {
  const clock = { now: T0 };
  const view = createAnimalsView({ animals: new THREE.Group() }, null, () => ({ x: 0, y: 0, visible: false }), { now: () => clock.now });
  view.setState(farm());
  const wants = run(view, clock, 120);
  const behaviours = new Set();
  // the hops really happen in this window (else the test proves nothing): sample the behaviour over a further minute
  for (let i = 0; i < 1800; i++) { clock.now += 1000 / 30; view.update(1 / 30); for (const d of view.debug()) if (d.behaviour) behaviours.add(d.behaviour); }
  assert.ok(behaviours.has('pronk'), `the alpacas pronk while idle (saw ${[...behaviours].join(', ') || 'nothing'})`);
  assert.equal(wants.get(WANT.INTERACTIVE) ?? 0, 0, `ticks that asked for the interactive frame: ${JSON.stringify([...wants])}`);
  assert.ok((wants.get(WANT.MOVING) ?? 0) > 0, 'a hop still asks for the moving (calm) rate, so it is drawn smoothly enough');
});

test('L-03: a pet and the happy jig after a collect are the player\'s doing: they keep the interactive frame', () => {
  const clock = { now: T0 };
  const view = createAnimalsView({ animals: new THREE.Group() }, null, () => ({ x: 0, y: 0, visible: false }), { now: () => clock.now });
  view.setState(farm());
  run(view, clock, 2);
  view.pet('al0');
  const petted = run(view, clock, 1);
  assert.ok((petted.get(WANT.INTERACTIVE) ?? 0) > 0, 'a petted animal leans in at the interactive rate');
  run(view, clock, 3);
  view.onEvent({ e: 'collected', id: 'al1' });
  const jig = run(view, clock, 0.5);
  assert.ok((jig.get(WANT.INTERACTIVE) ?? 0) > 0, 'the jig after a collect is interactive');
});
