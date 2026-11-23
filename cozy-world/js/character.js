// Mnki and Swan (and the villagers' shape kit): the procedural articulated chibi interpretations of the MNKISWAN canon,
// ported from scripts/character_visual.gd. Mnki: fluffy dark hair, golden double-spiral headband, red monkey-emblem
// hoodie, cargo trousers, red-and-white sneakers, curled tail. Swan: white swan hood with orange beak and gold crown,
// long chestnut hair, white pom-pom hoodie, pink pleated skirt, socks, blue-and-white sneakers, feather wings.
import * as THREE from 'three';
import { ball, box, cylinder, rod, tube } from './shapes.js';

const TAU = Math.PI * 2;

export function createCharacter(kind = 'mnki') {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const swan = kind === 'swan';
  const mnki = kind === 'mnki';
  const skin = '#e9b58d';
  const hair = '#513128';
  const cloth = swan ? '#f7f1e2' : mnki ? '#d9473e' : '#8b9c79';
  const arms = []; const legs = []; const wings = [];
  let tail = null;
  ball(body, [0, 0.94, 0], [0.65, 0.72, 0.43], cloth);
  ball(body, [0, 1.21, -0.12], [0.65, 0.35, 0.4], cloth);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.34, 1.13, 0);
    body.add(arm);
    ball(arm, [side * 0.075, -0.17, 0], [0.25, 0.45, 0.28], cloth);
    ball(arm, [side * 0.1, -0.39, 0.025], [0.2, 0.2, 0.19], skin);
    arms.push(arm);
    const leg = new THREE.Group();
    leg.position.set(side * 0.18, 0.64, 0);
    body.add(leg);
    ball(leg, [0, -0.22, 0], [0.26, 0.48, 0.28], swan ? skin : '#302b2a');
    if (swan) cylinder(leg, [0, -0.37, 0], 0.105, 0.18, '#f7f2e8');
    else box(leg, [side * 0.11, -0.15, 0.015], [0.08, 0.18, 0.19], '#3a302c');
    ball(leg, [0, -0.49, 0.09], [0.3, 0.18, 0.49], '#fff4e4');
    ball(leg, [0, -0.44, 0.06], [0.28, 0.2, 0.4], swan ? '#5488ae' : mnki ? '#c7453b' : '#665544');
    ball(leg, [0, -0.46, 0.23], [0.28, 0.13, 0.18], '#fff9ef');
    for (const z of [0.02, 0.08, 0.14]) rod(leg, [-0.07, -0.336, z], [0.07, -0.336, z + 0.025], 0.012, '#f7f1e2');
    legs.push(leg);
  }
  if (swan) {
    cylinder(body, [0, 0.63, 0], 0.43, 0.29, '#e7a1b4', 0.27);
    for (let i = 0; i < 14; i++) {
      const a = (i * TAU) / 14;
      rod(body, [Math.sin(a) * 0.28, 0.77, Math.cos(a) * 0.28], [Math.sin(a) * 0.43, 0.5, Math.cos(a) * 0.43], 0.015, '#f5bac8');
    }
  } else ball(body, [0, 0.88, 0.22], [0.33, 0.22, 0.05], mnki ? '#c64037' : '#8b9c79');
  for (const side of [-1, 1]) {
    rod(body, [side * 0.1, 1.23, 0.2], [side * 0.13, 0.97, 0.25], 0.013, swan ? '#f3dfbd' : '#57382e');
    if (swan) ball(body, [side * 0.13, 0.95, 0.25], [0.11, 0.11, 0.11], '#fff8eb');
  }
  if (mnki) {
    // the monkey-face chest emblem
    ball(body, [0, 1.0, 0.231], [0.25, 0.25, 0.05], '#815039');
    for (const side of [-1, 1]) ball(body, [side * 0.12, 1.01, 0.24], [0.1, 0.11, 0.05], '#946144');
    ball(body, [0, 0.98, 0.265], [0.19, 0.16, 0.035], '#f0ca92');
    for (const side of [-1, 1]) ball(body, [side * 0.04, 1.015, 0.29], [0.028, 0.035, 0.018], '#47302a');
    tail = new THREE.Group();
    tail.name = 'CurledMonkeyTail';
    body.add(tail);
    const pts = [[0, 0.68, -0.17], [0.1, 0.65, -0.5], [0.42, 0.78, -0.68], [0.7, 1.03, -0.63]];
    for (let i = 0; i < 17; i++) {
      const a = -0.55 + (i / 16) * Math.PI * 1.7;
      pts.push([0.68 + Math.sin(a) * 0.23, 1.24 - Math.cos(a) * 0.23, -0.63]);
    }
    tube(tail, pts, 0.075, '#805139');
  }
  if (swan) {
    for (const side of [-1, 1]) {
      const wing = new THREE.Group();
      wing.name = 'FeatherWing';
      wing.position.set(side * 0.23, 1.06, -0.23);
      body.add(wing);
      for (let i = 0; i < 5; i++) {
        const f = ball(wing, [side * (0.18 + i * 0.08), 0.09 - i * 0.075, -0.08 - i * 0.015], [0.54, 0.19, 0.17], '#fff8ed');
        f.rotation.z = side * (0.4 + i * 0.18);
      }
      wings.push(wing);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const lock = ball(body, [side * (0.3 + Math.sin(i * 1.8) * 0.05), 1.3 - i * 0.12, -0.12], [0.3, 0.4, 0.33], i % 2 === 0 ? '#684231' : hair);
        lock.rotation.z = side * 0.25;
      }
    }
    for (let i = 0; i < 5; i++) ball(body, [(i - 2) * 0.14, 0.92, -0.31], [0.26, 0.9, 0.27], hair);
  }
  const head = new THREE.Group();
  head.position.y = 1.66;
  body.add(head);
  ball(head, [0, 0.1, -0.02], [0.94, 0.91, 0.79], swan ? '#fcf5e9' : hair);
  ball(head, [0, -0.02, 0.13], [0.75, 0.7, 0.65], skin);
  for (const side of [-1, 1]) {
    ball(head, [side * 0.365, -0.03, 0.05], [0.17, 0.22, 0.16], skin);
    ball(head, [side * 0.16, 0.005, 0.425], [0.155, 0.2, 0.043], '#533528');
    ball(head, [side * 0.15, -0.015, 0.451], [0.085, 0.12, 0.021], '#352b26');
    ball(head, [side * 0.15 - 0.025, 0.047, 0.465], [0.042, 0.045, 0.02], '#fff6e8');
    ball(head, [side * 0.25, -0.12, 0.4], [0.16, 0.07, 0.025], '#dd9681');
  }
  ball(head, [0, -0.09, 0.46], [0.06, 0.07, 0.06], '#e2a77e');
  const smile = [];
  for (let i = 0; i < 9; i++) { const x = (i - 4) * 0.022; smile.push([x, -0.18 + (x / 0.09) ** 2 * 0.04, 0.441]); }
  tube(head, smile, 0.012, '#864a38');
  if (swan) {
    for (const side of [-1, 1]) {
      ball(head, [side * 0.39, 0.02, 0.05], [0.22, 0.68, 0.43], '#fff6e7');
      ball(head, [side * 0.24, 0.36, 0.31], [0.09, 0.05, 0.04], '#50362e');
    }
    ball(head, [0, 0.43, 0.36], [0.32, 0.13, 0.28], '#ec983e');
    const crown = new THREE.Group();
    crown.name = 'SmallGoldCrown';
    crown.position.set(0.17, 0.53, -0.06);
    crown.rotation.z = -0.18;
    head.add(crown);
    cylinder(crown, [0, 0, 0], 0.13, 0.1, '#edbd55');
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.085;
      cylinder(crown, [x, 0.11, 0], 0.055, 0.2, '#edbd55', 0);
      ball(crown, [x, 0.22, 0], [0.045, 0.045, 0.045], '#f8d176');
    }
    for (let i = 0; i < 5; i++) {
      const bang = ball(head, [(i - 2) * 0.13, 0.18, 0.34], [0.21, 0.35, 0.18], hair);
      bang.rotation.z = (i - 2) * 0.15;
    }
  } else {
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      const tuft = ball(head, [Math.sin(a) * 0.35, 0.17 + Math.cos(a) * 0.28, 0.03], [0.37, 0.35, 0.5], i % 3 === 0 ? '#603d2c' : hair);
      tuft.rotation.z = -a * 0.6;
    }
    for (let i = 0; i < 5; i++) {
      const tuft = ball(head, [(i - 2) * 0.14, 0.22, 0.35], [0.22, 0.33, 0.22], hair);
      tuft.rotation.z = -0.3 + (i - 2) * 0.1;
    }
    // rounded locks round the back so the silhouette stays fluffy
    for (let i = 0; i < 9; i++) {
      const a = (i * TAU) / 9;
      const tuft = ball(head, [Math.sin(a) * 0.31, 0.14 + Math.cos(a) * 0.25, -0.3], [0.31, 0.31, 0.26], hair);
      tuft.rotation.z = -a;
    }
    if (mnki) {
      // the golden headband and its double inward spiral
      tube(head, [[-0.38, 0.17, 0.27], [-0.26, 0.29, 0.38], [0, 0.33, 0.43], [0.26, 0.29, 0.38], [0.38, 0.17, 0.27]], 0.033, '#edb94c');
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i < 25; i++) {
          const a = (i / 24) * TAU * 1.15;
          const r = 0.115 + (0.019 - 0.115) * (i / 24);
          pts.push([side * (0.105 + Math.cos(a) * r), 0.38 + Math.sin(a) * r, 0.455]);
        }
        tube(head, pts, 0.025, '#f3c65b');
      }
    }
  }
  let phase = 0;
  const ch = {
    root, body, head, arms, legs, wings, tail, kind, reaction: 0,
    /** One frame of the walk cycle at ground speed `speed` (m/s). */
    animate(dt, speed, reduced = false) {
      phase += dt * (3 + speed * 2.2);
      ch.reaction = Math.max(0, ch.reaction - dt);
      const k = Math.min(speed / 4, 1);
      body.position.y = Math.abs(Math.sin(phase)) * 0.045 * k * (reduced ? 0 : 1);
      head.rotation.z = Math.sin(phase * 0.32) * (reduced ? 0 : 0.025);
      for (let i = 0; i < 2; i++) {
        legs[i].rotation.x = Math.sin(phase + i * Math.PI) * 0.55 * k;
        arms[i].rotation.x = Math.sin(phase + (i + 1) * Math.PI) * 0.4 * k;
        arms[i].rotation.z = (i === 0 ? 1 : -1) * (0.12 + Math.max(ch.reaction, 0) * 0.65);
      }
      if (tail) tail.rotation.y = Math.sin(phase * 0.35) * 0.12;
      wings.forEach((w, i) => { w.rotation.z = Math.sin(phase * 0.4) * 0.08 * (i === 0 ? 1 : -1); });
    },
  };
  return ch;
}
