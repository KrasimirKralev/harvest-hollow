// The village (port of scripts/world.gd): thirteen named places on one connected map, their props, the interactables
// (gathering sources, plots, the jetty, animals, guardians, the board, stalls, the treehouse and its rooms, villagers)
// and the visible changes the requests make (the welcome basket, the park flowers, the picnic, the guardians' path,
// the festival lanterns, the stall improvements and the treehouse decorations).
import * as THREE from 'three';
import { ITEMS, CROPS, DECOR, REGIONS, NPCS, EDGES, GUARDIANS } from './data.js';
import * as S from './shapes.js';

const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { f: next, range: (lo, hi) => lo + next() * (hi - lo) };
}

const RING_GEO = new THREE.TorusGeometry(0.43, 0.03, 8, 24);

export function createWorld(scene, state) {
  const R = rng(4732);
  const root = new THREE.Group();
  root.name = 'CozyWorld';
  scene.add(root);
  const interactables = [];
  const npcs = [];

  // ---- light and sky ----
  const hemi = new THREE.HemisphereLight('#c3d9cf', '#829779', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe1b0', 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#b6d5da', 0.35);
  fill.position.set(-30, 40, -40);
  scene.add(fill);
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#8fb3bb') }, horizon: { value: new THREE.Color('#eee7ce') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  scene.fog = new THREE.FogExp2('#d9dfcc', 0.0085);

  // ---- helpers ----
  function interact(kind, id, p, item = '', title = '') {
    const g = new THREE.Group();
    g.name = id;
    g.position.set(p[0], p[1], p[2]);
    root.add(g);
    const ring = new THREE.Mesh(RING_GEO, S.mat('#f4d58a', true));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.045;
    ring.visible = false;
    g.add(ring);
    const n = { kind, id, item, title, reach: 2.7, priority: 0, group: g, ring, fruit: null, soil: null, cropVisual: null, lastStage: -99, phase: 0 };
    interactables.push(n);
    return n;
  }
  function path(a, b, width = 3) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = S.box(root, [mid[0], 0.035, mid[1]], [width, 0.035, len], '#d5c49a');
    n.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    n.castShadow = false;
    for (const p of [a, b]) S.cylinder(root, [p[0], 0.035, p[1]], width / 2, 0.035, '#d5c49a').castShadow = false;
  }
  function bush(pos, id, item = 'berry') {
    const n = interact('gather', id, pos, item);
    S.ball(n.group, [0, 0.45, 0], [1.35, 0.95, 1.2], '#70935e');
    S.ball(n.group, [0.4, 0.39, 0], [0.8, 0.7, 0.8], '#8ba96d');
    n.fruit = new THREE.Group();
    n.group.add(n.fruit);
    for (let i = 0; i < 7; i++) {
      const a = (i * TAU) / 7;
      S.ball(n.fruit, [Math.cos(a) * 0.48, 0.65 + (i % 2) * 0.12, Math.sin(a) * 0.42], [0.18, 0.18, 0.18], ITEMS[item].color);
    }
    S.collideCircle(n.group, [0, 0.45, 0], 0.55, 0.9);
  }

  // ---- terrain ----
  S.cylinder(root, [0, -0.65, 8], 66, 1.25, '#8b9d70').castShadow = false;
  S.cylinder(root, [0, -2.1, 8], 65.7, 2.1, '#ac9871', 64);
  S.cylinder(root, [0, -3.5, 8], 64, 1.5, '#8c7c5e', 60);
  for (const r of REGIONS) {
    S.cylinder(root, [r.p[0], 0.013, r.p[1]], 8.2, 0.025, ['pond', 'market', 'paddy'].includes(r.id) ? '#b4b38a' : '#a6b783').castShadow = false;
    const sign = [r.p[0] - 3, 0, r.p[1] + 6.3];
    S.cylinder(root, [sign[0], 0.55, sign[2]], 0.055, 1.1, '#987355');
    S.box(root, [sign[0], 1.12, sign[2]], [2.6, 0.62, 0.13], '#efe0b8');
    S.label(root, r.name, [sign[0], 1.17, sign[2] + 0.09], 19, '#fff5d9');
  }
  for (let i = 0; i < 70; i++) {
    const a = R.f() * TAU; const rr = R.range(55, 64);
    const p = [Math.sin(a) * rr, 0, 8 + Math.cos(a) * rr];
    if (i % 2 === 0) S.tree(root, p, R.range(1.0, 1.65), ['#708e61', '#819e6a', '#91a36c'][i % 3], false);
    else S.ball(root, [p[0], 0.3, p[2]], [1.6, 0.8, 1.3], '#a0a58a');
  }
  for (let i = 0; i < 190; i++) {
    const n = S.ball(root, [R.range(-49, 48), 0.035, R.range(-43, 51)], [0.1, 0.05, 0.15], ['#c4cc9a', '#b4c48a', '#d6d4a5'][i % 3]);
    n.castShadow = false;
  }

  // ---- paths and lanterns ----
  for (const [a, b] of EDGES) path(REGIONS[a].p, REGIONS[b].p);
  for (const p of [[-19, 0, 6], [4, 0, 9], [19, 0, 9], [-24, 0, 27], [10, 0, 34], [-20, 0, -12]]) S.lantern(root, p);

  // ---- Sunshine Forest ----
  for (const p of [[-35, 0, -27], [-25, 0, -31], [-33, 0, -19], [-23, 0, -25], [-37, 0, -34]]) S.tree(root, p, 1.1, '#8ba971');
  bush([-27, 0, -19], 'forest_berry');
  bush([-31, 0, -28], 'forest_berry2');
  for (let i = 0; i < 9; i++) S.flower(root, [-29 + R.range(-6, 6), 0, -25 + R.range(-6, 6)], '#efc386', 0.7);
  S.bench(root, [-34, 0, -23], 0.5);
  S.label(root, 'TREE VILLAGE\nWelcome, Mnki & Swan', [-28, 2.4, -28], 26);

  // ---- Waterfall & Ponds ----
  const waterMat = new THREE.MeshStandardMaterial({ color: '#4fa3a5', roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.92 });
  const lake = S.cylinder(root, [0, 0.09, -32], 7, 0.09, '#6cb2ae');
  lake.material = waterMat; lake.scale.z = 0.72; lake.castShadow = false;
  S.collideBox(root, [0, 0.25, -32], [10, 0.5, 5.6]);
  for (let i = 0; i < 13; i++) {
    const a = (i * Math.PI) / 12;
    S.ball(root, [Math.cos(a) * 7, 0.35, -32 - Math.sin(a) * 4.5], [1.8, 1.0, 1.3], '#8a9b90');
  }
  for (let i = 0; i < 6; i++) S.ball(root, [-1 + (i % 3) * 1.1, 2.5 + i * 0.27, -37.8], [2.0, 4.5, 1.8], '#8c9d8f');
  const streams = [];
  for (let i = 0; i < 5; i++) {
    const s = S.box(root, [-0.9 + i * 0.45, 2.4, -36.7], [0.5, 4.6, 0.12], '#b2d8cf');
    s.material = waterMat; streams.push(s);
  }
  for (let i = 0; i < 9; i++) S.box(root, [0, 0.19, -24.5 - i * 0.27], [2.3, 0.17, 0.24], '#b19770');
  for (const x of [-1.1, 1.1]) for (const z of [-24.4, -26.5]) S.cylinder(root, [x, 0.3, z], 0.065, 0.8, '#9a795b');
  const jetty = interact('fish', 'fishing_jetty', [0, 0.2, -25.5]);
  jetty.priority = 0.4;
  for (let i = 0; i < 7; i++) S.cylinder(root, [R.range(-5, 5), 0.17, R.range(-34, -29)], 0.35, 0.03, '#92b78b').castShadow = false;
  S.bench(root, [4, 0, -24], 0.4);

  // ---- Cherry Berry Maze ----
  for (const z of [-30, -26, -22]) for (const x of [22, 25, 28, 31]) { if (x === 25 && z === -26) continue; bush([x, 0, z], `berry_${x}_${z}`); }
  for (let i = 0; i < 5; i++) S.box(root, [21.2 + i * 2.4, 0.35, -32], [2.5, 0.7, 0.75], '#78945f', true);
  S.tree(root, [32, 0, -30], 1.0, '#9b9e70');

  // ---- Village Flower Garden ----
  const gcols = ['#e6a0ac', '#e8c77f', '#b5a0c8', '#e9dfbd'];
  for (let i = 0; i < 12; i++) {
    const n = interact('gather', `flower_${i}`, [24 + (i % 4) * 2.6, 0, -9 + Math.floor(i / 4) * 3.3], 'flower');
    S.cylinder(n.group, [0, 0.03, 0], 0.65, 0.05, '#93765c').castShadow = false;
    n.fruit = new THREE.Group();
    n.group.add(n.fruit);
    for (let j = 0; j < 4; j++) S.flower(n.fruit, [Math.cos((j * TAU) / 4) * 0.3, 0, Math.sin((j * TAU) / 4) * 0.3], gcols[i % 4], 0.85);
  }
  for (const x of [23, 35]) S.rod(root, [x, 0, -5], [x, 2.6, -5], 0.09, '#a18b65');
  S.rod(root, [23, 2.6, -5], [35, 2.6, -5], 0.09, '#a18b65');
  S.bench(root, [32, 0, 3]);

  // ---- Paddy Field ----
  for (let i = 0; i < 12; i++) {
    const n = interact('plot', `plot_${String(i).padStart(2, '0')}`, [23 + (i % 4) * 2.7, 0.045, 16 + Math.floor(i / 4) * 2.8]);
    n.soil = S.box(n.group, [0, 0.035, 0], [1.85, 0.08, 1.85], '#87674e');
    n.soil.castShadow = false;
    for (let j = 0; j < 4; j++) S.box(n.group, [0, 0.08, -0.65 + j * 0.43], [1.6, 0.035, 0.06], '#9c7d5b').castShadow = false;
  }
  for (const x of [21.6, 24.35, 27.05, 29.75, 32.5]) S.box(root, [x, 0.06, 18.8], [0.3, 0.08, 8.4], '#88b6ac').castShadow = false;
  S.box(root, [34, 1.0, 22], [2.7, 2, 2.5], '#b39c74', true);
  S.cylinder(root, [34, 2.3, 22], 2.2, 0.8, '#a67c54', 0.1);
  S.label(root, '1–5  ·  choose seed', [27, 1.6, 23], 18);

  // ---- Tropical Fruit Forest ----
  const fruitIds = ['mango', 'banana', 'coconut'];
  for (let i = 0; i < 9; i++) {
    const p = [15 + (i % 3) * 5.3, 0, 34 + Math.floor(i / 3) * 5];
    const item = fruitIds[i % 3];
    const t = S.tree(root, p, 0.85, item === 'mango' ? '#91a66b' : '#8aa56b');
    if (item === 'coconut') t.scale.set(0.7, 1.25, 0.7);
    const n = interact('gather', `fruit_${i}`, [p[0], 0, p[2] + 1.25], item);
    n.reach = 3.0;
    n.fruit = new THREE.Group();
    n.group.add(n.fruit);
    for (let j = 0; j < 4; j++) {
      const fp = [Math.cos((j * TAU) / 4) * 0.9, 1.9 + Math.sin(j) * 0.3, -1.25 + Math.sin((j * TAU) / 4) * 0.9];
      S.ball(n.fruit, fp, item !== 'banana' ? [0.35, 0.46, 0.31] : [0.18, 0.6, 0.18], ITEMS[item].color);
    }
    S.box(n.group, [0, 0.2, 0], [0.7, 0.4, 0.55], '#b6966e');
  }

  // ---- Thronn's Animal Farm ----
  function animal(id, p) {
    const n = interact('animal', id, p, '', id.charAt(0).toUpperCase() + id.slice(1));
    const chicken = id === 'chicken'; const wool = id === 'sheep';
    const c = id !== 'cow' ? '#f3ead8' : '#e2d9c1';
    const g = n.group;
    n.visual = new THREE.Group(); g.add(n.visual);
    const v = n.visual;
    S.ball(v, [0, 0.65, 0], chicken ? [0.55, 0.55, 0.55] : [1.3, 0.85, 0.7], c);
    S.ball(v, [0, 0.85, 0.51], chicken ? [0.28, 0.28, 0.28] : [0.56, 0.6, 0.45], c);
    if (chicken) {
      S.ball(v, [0, 1.05, 0.52], [0.12, 0.14, 0.17], '#c9634b');
      S.cylinder(v, [0, 0.83, 0.7], 0.08, 0.16, '#e6b24f', 0).rotation.x = Math.PI / 2;
    } else if (wool) {
      for (let j = 0; j < 10; j++) { const a = (j * TAU) / 10; S.ball(v, [Math.cos(a) * 0.5, 0.65, Math.sin(a) * 0.28], [0.47, 0.47, 0.47], '#efe7d5'); }
      S.ball(v, [0, 0.8, 0.66], [0.36, 0.26, 0.16], '#a0927d');
    } else {
      S.ball(v, [0.2, 0.76, 0.1], [0.5, 0.67, 0.6], '#7e735e');
      S.ball(v, [0, 0.7, 0.72], [0.4, 0.24, 0.18], '#d1a48b');
      for (const side of [-1, 1]) S.cylinder(v, [side * 0.24, 1.18, 0.49], 0.06, 0.25, '#c4b68f', 0);
    }
    for (const side of [-1, 1]) {
      S.ball(v, [side * 0.16, 0.91, 0.7], [0.055, 0.055, 0.055], '#40362c');
      S.ball(v, [side * 0.31, 0.97, 0.49], [0.25, 0.11, 0.15], c);
      for (const z of [-0.23, 0.27]) S.cylinder(v, [side * 0.28, 0.24, z], chicken ? 0.025 : 0.075, 0.47, '#9a8061');
    }
    S.collideCircle(g, [0, 0.45, 0], chicken ? 0.27 : 0.42, 0.85);
    S.label(g, n.title, [0, 1.6, 0], 19);
  }
  S.box(root, [-5, 1.5, 46], [6, 3, 3], '#ad7055', true);
  S.cylinder(root, [-5, 3.5, 46], 4, 1.4, '#7d8c69', 0.1);
  S.box(root, [-5, 1.1, 44.45], [1.8, 2.2, 0.12], '#e0bc83');
  S.label(root, 'THRONN’S FARM', [-5, 2.8, 44.3], 22);
  for (let i = 0; i < 11; i++) {
    const x = -12 + i * 1.4;
    for (const z of [34, 44]) {
      if (z === 34 && x > -6 && x < 0) continue;
      S.box(root, [x, 0.55, z], [0.12, 1.1, 0.12], '#d0bc90');
      S.box(root, [x + 0.7, 0.65, z], [1.4, 0.12, 0.12], '#d0bc90');
    }
  }
  animal('cow', [-8, 0, 39]);
  animal('sheep', [-3, 0, 40]);
  animal('chicken', [1, 0, 37]);
  S.box(root, [-9, 0.3, 42], [2.0, 0.6, 0.6], '#ad8c65');
  S.tree(root, [-12, 0, 39], 1.2, '#95a16a');

  // ---- The Three Guardians ----
  GUARDIANS.forEach((id, i) => {
    const x = -34 + i * 4;
    S.cylinder(root, [x, 0.35, -6], 0.95, 0.7, '#b5b3a0');
    S.ball(root, [x, 1.25, -6], [1.1, 1.6, 0.9], '#a3ad98');
    S.ball(root, [x, 2.2, -6], [1.0, 0.85, 0.85], '#b9bdab');
    if (i === 0) for (const side of [-1, 1]) S.cylinder(root, [x + side * 0.3, 2.75, -6], 0.12, 0.6, '#9fa78e', 0);
    else if (i === 1) S.ball(root, [x, 2.2, -5.5], [0.5, 0.23, 0.4], '#a9bcae');
    else for (const side of [-1, 1]) S.ball(root, [x + side * 0.5, 1.4, -6], [0.7, 0.4, 0.4], '#acb49a');
    for (const side of [-1, 1]) S.ball(root, [x + side * 0.19, 2.28, -5.59], [0.1, 0.1, 0.1], '#67795c');
    S.label(root, id.toUpperCase(), [x, 0.65, -5.05], 18);
    S.collideCircle(root, [x, 1, -6], 0.95, 2);
    interact('guardian', id, [x, 0, -4.5], '', id.charAt(0).toUpperCase() + id.slice(1));
  });
  for (const x of [-36, -23]) S.cylinder(root, [x, 2.2, -10], 0.22, 4.4, '#98856b');
  S.rod(root, [-36, 4.4, -10], [-23, 4.4, -10], 0.25, '#98856b');

  // ---- Village Park ----
  S.tree(root, [0, 0, -6], 1.5, '#98ae78');
  for (const p of [[-4, 0, -1], [4, 0, -1]]) S.bench(root, p, Math.PI);
  S.cylinder(root, [0, 0.35, -1], 1.6, 0.7, '#b5b7a0');
  S.cylinder(root, [0, 0.75, -1], 1.3, 0.12, '#8bb9ad');
  S.cylinder(root, [0, 1.1, -1], 0.25, 0.8, '#bfc2ab');
  S.collideCircle(root, [0, 0.5, -1], 1.6, 1);
  const board = interact('board', 'community_board', [4.5, 0, -4]);
  board.priority = 0.3;
  S.box(board.group, [0, 1.4, 0], [2.0, 1.35, 0.18], '#967759');
  S.box(board.group, [0, 1.4, 0.11], [1.75, 1.1, 0.03], '#e5d7b3');
  for (const x of [-0.7, 0.7]) S.cylinder(board.group, [x, 0.75, 0], 0.07, 1.5, '#967759');
  for (let i = 0; i < 3; i++) S.box(board.group, [-0.5 + i * 0.5, 1.4, 0.16], [0.35, 0.6, 0.015], ['#efe8d0', '#eedab8', '#ead2be'][i]);
  S.label(board.group, 'VILLAGE REQUESTS', [0, 2.3, 0], 20);

  // ---- treehouses: ours and the colonies ----
  function treehouse(pos, title, color, home = false) {
    const r = new THREE.Group();
    r.position.set(pos[0], pos[1], pos[2]);
    root.add(r);
    S.cylinder(r, [0, 2.8, 0], 0.82, 5.6, '#8e6a4c', 0.58);
    S.cylinder(r, [0, 1.0, 0], 3.1, 0.3, '#ac8b62');
    S.cylinder(r, [0, 2.4, 0], 2.45, 2.7, color);
    S.cylinder(r, [0, 4.7, 0], 2.7, 2.0, '#92a571', 0.2);
    S.cylinder(r, [0, 3.7, 0], 2.5, 0.2, '#e0bf86');
    S.box(r, [0, 1.7, 2.42], [0.9, 1.7, 0.18], '#635344');
    for (const x of [-1.35, 1.35]) {
      S.box(r, [x, 2.4, 2.1], [0.72, 0.8, 0.15], '#f1cf8a').material = S.mat('#f1cf8a', true);
      S.box(r, [x, 2.4, 2.21], [0.06, 0.83, 0.07], '#7c664f');
      S.box(r, [x, 2.4, 2.21], [0.75, 0.06, 0.07], '#7c664f');
    }
    for (let i = 0; i < 5; i++) S.box(r, [0, 0.1 + i * 0.16, 4.15 - i * 0.42], [1.5, 0.2 + i * 0.32, 0.46], '#bda078');
    for (let i = 0; i < 5; i++) { const a = (i * TAU) / 5; S.ball(r, [Math.cos(a) * 0.8, 5.2, Math.sin(a) * 0.8], [2.6, 2.0, 2.6], '#8ca36d'); }
    S.label(r, title, [0, 4.0, 2.2], 22);
    S.collideCircle(r, [0, 1.5, 0], 3.1, 3);
    if (home) { const h = interact('home', 'our_home', [pos[0], pos[1] + 0.1, pos[2] + 4.7]); h.priority = 0.5; }
  }
  treehouse([-14, 0, 14], 'Our Treehouse', '#ab7758', true);
  for (let i = 0; i < 3; i++) treehouse([-38 + i * 4.5, 0, 18 + (i % 2) * 8], ['Hazel’s Workshop', 'Willow House', 'Fern Cottage'][i], '#b9a07f');
  for (let i = 0; i < 3; i++) {
    const p = [-35 + i * 5, 0, 43 + (i % 2) * 4];
    treehouse(p, ['Canopy Nest', 'Lantern House', 'The Lookout'][i], '#a2aa89');
    S.lantern(root, [p[0] + 2, 0, p[2] + 4]);
  }
  for (let i = 0; i < 12; i++) S.box(root, [-32 + i * 0.7, 0.12, 40], [0.65, 0.15, 1.6], '#b39b74');

  // ---- Market Square ----
  function stall(pos, color, title) {
    const r = new THREE.Group();
    r.position.set(pos[0], pos[1], pos[2]);
    root.add(r);
    S.box(r, [0, 0.6, 0], [3, 1.2, 1.25], '#ae8a60', true);
    for (const x of [-1.45, 1.45]) for (const z of [-0.55, 0.55]) S.cylinder(r, [x, 1.6, z], 0.07, 3.2, '#9b7955');
    for (let i = 0; i < 7; i++) {
      const x = -1.5 + i * 0.5;
      S.box(r, [x, 2.75, 0], [0.5, 0.16, 2.1], i % 2 === 0 ? color : '#f0e4c8').rotation.x = -0.1;
      S.ball(r, [x, 2.62, 1.02], [0.49, 0.35, 0.1], i % 2 === 0 ? color : '#f0e4c8');
    }
    S.box(r, [0, 1.98, 0.7], [2.8, 0.5, 0.1], '#f2e2bc');
    S.label(r, title, [0, 2.01, 0.78], 19);
    for (const x of [-0.95, 0, 0.95]) {
      S.box(r, [x, 1.3, 0], [0.75, 0.22, 0.8], '#cfac7b');
      for (let i = 0; i < 4; i++) S.ball(r, [x + (i % 2) * 0.25 - 0.12, 1.5, Math.floor(i / 2) * 0.3 - 0.15], [0.24, 0.24, 0.24], ['#d5a14c', '#b85d64', '#a9b770'][Math.floor(Math.abs(x) * 2) % 3]);
    }
  }
  S.cylinder(root, [9, 0.045, 15], 7.7, 0.04, '#d2bf97').castShadow = false;
  stall([8, 0, 12], '#ca795e', 'MNKI & SWAN · FRESH FRUIT');
  interact('stall', 'fruit_stall', [8, 0, 14.3]).priority = 0.3;
  stall([15, 0, 17], '#8caa96', 'SEEDS & LITTLE TREASURES');
  interact('stall', 'seed_stall', [15, 0, 19.3]).priority = 0.3;
  S.bench(root, [6, 0, 20], Math.PI);
  for (let i = 0; i < 7; i++) {
    const x = 3 + i * 2.4;
    S.rod(root, [x, 3.9, 13], [x + 1.0, 3.7, 13], 0.025, '#a79770');
    S.cylinder(root, [x, 3.55, 13], 0.18, 0.4, ['#e8bb75', '#d59c9d', '#9aad87'][i % 3], 0).rotation.z = Math.PI;
  }

  // ---- villagers ----
  for (const info of NPCS) {
    // (no collider: the villagers gather round the old tree for the festival, and a baked one would stay behind)
    const n = interact('npc', info.id, [info.p[0], 0, info.p[1]], '', info.name);
    const v = new THREE.Group();
    n.group.add(v);
    S.ball(v, [0, 0.75, 0], [0.65, 0.9, 0.5], info.color);
    S.ball(v, [0, 1.42, 0], [0.72, 0.72, 0.66], '#dfb68d');
    S.ball(v, [0, 1.62, -0.05], [0.78, 0.48, 0.66], '#76604b');
    S.cylinder(v, [0, 1.79, 0], 0.5, 0.12, info.color);
    S.cylinder(v, [0, 1.93, 0], 0.28, 0.3, info.color, 0.19);
    for (const side of [-1, 1]) {
      S.ball(v, [side * 0.13, 1.44, 0.31], [0.065, 0.065, 0.065], '#403528');
      S.ball(v, [side * 0.34, 0.8, 0], [0.22, 0.57, 0.25], info.color);
      S.ball(v, [side * 0.35, 0.52, 0], [0.15, 0.15, 0.15], '#dfb68d');
      S.ball(v, [side * 0.18, 0.18, 0.06], [0.24, 0.37, 0.35], '#685a46');
    }
    S.label(n.group, info.name, [0, 2.4, 0], 19);
    npcs.push({ n, visual: v, p: n.group.position.clone(), phase: R.f() * TAU });
  }

  // ---- the treehouse inside (far east of the map, x = 150) ----
  const inside = new THREE.Group();
  inside.name = 'TreehouseInterior';
  inside.position.set(150, 0, 0);
  root.add(inside);
  for (const y of [0, 4]) {
    S.box(inside, [0, y - 0.15, 0], [13, 0.3, 11], '#b5946b', true);
    for (const x of [-6.5, 6.5]) S.box(inside, [x, y + 1.35, 0], [0.2, 2.7, 11], '#d9c7a3', true);
    S.box(inside, [0, y + 1.35, -5.5], [13, 2.7, 0.2], '#d9c7a3', true);
    for (const x of [-4, 4]) {
      S.box(inside, [x, y + 1.6, -5.35], [2, 1.4, 0.1], '#adc9c1');
      S.box(inside, [x, y + 1.6, -5.25], [0.08, 1.45, 0.08], '#987956');
    }
    for (const z of [-5.2, 5.2]) S.box(inside, [0, y + 0.3, z], [13, 0.6, 0.15], '#aa8a64', true);
    const light = new THREE.PointLight('#ffe1b2', 18, 12, 1.6);
    light.position.set(0, y + 2.0, 0);
    inside.add(light);
    for (let i = 0; i < 19; i++) S.box(inside, [-6.15 + i * 0.68, y + 0.015, 0], [0.015, 0.015, 10.4], '#9a805e').castShadow = false;
    S.cylinder(inside, [-3, y + 0.035, -0.2], 2.0, 0.035, '#bd9b83').scale.z = 0.7;
    for (const x of [-5.8, 5.8]) S.box(inside, [x, y + 1.4, -4.6], [0.65, 2.5, 0.12], '#b8bb94');
    S.lantern(inside, [5.5, y, -4.5]);
  }
  // a cosy living room, the upstairs kitchen and the sleeping nook
  S.box(inside, [-3, 0.5, -3], [3.2, 0.9, 1.2], '#9aaf8d', true);
  S.box(inside, [-3, 1.1, -3.5], [3.2, 0.8, 0.3], '#8d9e7a');
  S.box(inside, [-3, 0.38, -0.8], [1.8, 0.75, 1.0], '#997e5b', true);
  S.box(inside, [4, 0.6, -3.5], [2, 1.2, 0.8], '#b5956c', true);
  S.box(inside, [-3, 4.45, -2.5], [3.4, 0.9, 2.0], '#9b7a57', true);
  S.box(inside, [-3, 4.95, -2.5], [3.3, 0.25, 1.9], '#e9bea5');
  for (const x of [-4, -2]) S.ball(inside, [x, 5.15, -3], [1.1, 0.25, 0.7], '#f6ead4');
  S.box(inside, [3, 4.7, -3.7], [3.8, 1.4, 1], '#b79771', true);
  S.box(inside, [3, 5.45, -3.7], [3.9, 0.12, 1.1], '#e1d3ad');
  S.cylinder(inside, [2, 5.65, -3.7], 0.24, 0.3, '#739797');
  S.label(inside, 'OUR TREEHOUSE', [0, 2.4, -5.2], 26);
  S.label(inside, 'A LITTLE ROOM TO DREAM', [0, 6.4, -5.2], 26);
  interact('home_menu', 'home_living', [150, 0, 0]).priority = 0.4;
  interact('home_menu', 'home_bed', [147, 4, -0.4]).priority = 0.4;
  interact('upstairs', 'stairs_up', [155, 0, 1.0]);
  interact('downstairs', 'stairs_down', [155, 4, 1.0]);
  interact('exit', 'home_exit', [150, 0, 4.0]);
  S.label(inside, 'Rest · Storage · Decorate', [0, 1.8, 0], 22);
  S.label(inside, 'UPSTAIRS ↑', [5, 1.0, 1], 20);
  S.label(inside, '← VILLAGE', [0, 1.1, 4.8], 20);

  const decorations = new THREE.Group(); decorations.name = 'HomeDecorations'; root.add(decorations);
  const improvements = new THREE.Group(); improvements.name = 'VillageImprovements'; root.add(improvements);
  const stallDisplay = new THREE.Group(); root.add(stallDisplay);
  S.bakeColliders();

  // ---- the visible consequences of the requests ----
  let decorSig = ''; let flagSig = ''; let stallSig = '';
  const portraitTex = new THREE.TextureLoader().load('assets/portraits/couple.webp');
  portraitTex.colorSpace = THREE.SRGBColorSpace;
  function decoration(parent, id, p) {
    const at = (dx, dy, dz) => [p[0] + dx, p[1] + dy, p[2] + dz];
    switch (id) {
      case 'rug': S.cylinder(parent, at(0, 0.025, 0), 0.85, 0.05, '#d5a38c').scale.z = 0.75; break;
      case 'lamp': S.lantern(parent, p); break;
      case 'plant': case 'flowers':
        S.cylinder(parent, at(0, 0.22, 0), 0.25, 0.44, '#bb8e6b', 0.3);
        for (let i = 0; i < 4; i++) S.flower(parent, at(Math.cos(i) * 0.14, 0.43, Math.sin(i) * 0.14), id === 'plant' ? '#a8b879' : '#d9a3b3');
        break;
      case 'picture': {
        S.box(parent, at(0, 0.9, 0), [0.9, 1.2, 0.1], '#a87d58');
        const q = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1), new THREE.MeshBasicMaterial({ map: portraitTex, transparent: true }));
        q.position.set(...at(0, 0.91, 0.065));
        parent.add(q);
        break;
      }
      case 'stool': S.cylinder(parent, at(0, 0.3, 0), 0.15, 0.6, '#c4b18b'); S.ball(parent, at(0, 0.65, 0), [0.8, 0.3, 0.8], '#d69483'); break;
      case 'shelf':
        for (const y of [0.2, 0.8, 1.4]) S.box(parent, at(0, y, 0), [0.9, 0.12, 0.5], '#a6845c');
        for (const x of [-0.4, 0.4]) S.box(parent, at(x, 0.8, 0), [0.1, 1.6, 0.5], '#a6845c');
        break;
      case 'basket': S.box(parent, at(0, 0.25, 0), [0.6, 0.5, 0.5], '#c4a171'); break;
      case 'keepsake': S.cylinder(parent, at(0, 0.5, 0), 0.25, 1, '#e1bb68', 0); S.ball(parent, at(0, 1.1, 0), [0.25, 0.25, 0.25], '#f2d482'); break;
      case 'kettle': S.cylinder(parent, at(0, 0.3, 0), 0.5, 0.6, '#aa8763'); S.ball(parent, at(0, 0.8, 0), [0.5, 0.4, 0.5], '#90aaa0'); break;
      default:
    }
    S.label(parent, DECOR[id].name, at(0, 1.7, 0), 16);
  }

  function refresh() {
    const d = state.data;
    const sig = JSON.stringify(d.decor_placed);
    if (sig !== decorSig) {
      decorSig = sig;
      S.clear(decorations);
      for (const [anchor, id] of Object.entries(d.decor_placed)) {
        const i = Number(anchor);
        decoration(decorations, id, [146 + (i % 5) * 2.0, i < 5 ? 0.03 : 4.03, 2.2]);
      }
    }
    const fsig = JSON.stringify(d.flags);
    if (fsig !== flagSig) {
      flagSig = fsig;
      S.clear(improvements);
      const festival = d.flags.includes('festival');
      npcs.forEach((n, i) => {
        const a = (i * TAU) / npcs.length;
        if (festival) n.n.group.position.set(Math.cos(a) * 5, 0, -4 + Math.sin(a) * 5); else n.n.group.position.copy(n.p);
      });
      if (d.flags.includes('basket')) {
        S.box(improvements, [2.5, 0.3, -2], [0.8, 0.6, 0.7], '#c19b6e');
        for (let i = 0; i < 6; i++) S.ball(improvements, [2.3 + (i % 3) * 0.18, 0.65, -2 + Math.floor(i / 3) * 0.2], [0.2, 0.2, 0.2], '#bd6876');
      }
      if (d.flags.includes('park_flowers')) {
        for (let i = 0; i < 22; i++) { const a = (i * TAU) / 22; S.flower(improvements, [Math.cos(a) * 3.2, 0, -6 + Math.sin(a) * 3.2], ['#e8aaae', '#e5c97f', '#b8a6c8'][i % 3]); }
      }
      if (d.flags.includes('picnic')) {
        S.box(improvements, [5, 0.07, -27], [2.4, 0.06, 1.8], '#d4998c');
        S.cylinder(improvements, [5, 0.16, -27], 0.32, 0.1, '#f2ddaf');
      }
      if (d.flags.includes('shortcut')) {
        const a = [-26, -6]; const b = [23, -6];
        const n = S.box(improvements, [(a[0] + b[0]) / 2, 0.04, -6], [2, 0.035, b[0] - a[0]], '#d5c49a');
        n.rotation.y = Math.PI / 2;
        S.label(improvements, 'THE GUARDIANS’ GARDEN · OPEN', [-19, 1.7, -6], 20);
      }
      if (festival) for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; S.lantern(improvements, [Math.cos(a) * 7, 0, -4 + Math.sin(a) * 7]); }
    }
    const ssig = `${d.stall_tier}:${Math.floor(state.metric('earned') / 10)}`;
    if (ssig !== stallSig) {
      stallSig = ssig;
      S.clear(stallDisplay);
      for (let tier = 0; tier < d.stall_tier; tier++) {
        S.box(stallDisplay, [5.6, 0.6 + tier * 0.7, 12], [1, 0.12, 1.1], '#c3a273');
        for (let j = 0; j < 4; j++) S.ball(stallDisplay, [5.35 + (j % 2) * 0.35, 0.83 + tier * 0.7, 11.8 + Math.floor(j / 2) * 0.35], [0.27, 0.27, 0.27], ['#e7b758', '#c5766b', '#adba76'][tier]);
      }
      if (state.metric('earned') > 0) S.label(stallDisplay, 'GROWN WITH CARE ♥', [8, 0.65, 12.7], 18);
    }
  }

  // ---- per frame: the day's light, the villagers' idle, the sources and plots ----
  let t = 0;
  function update(dt, focus) {
    t += dt;
    const d = state.data;
    const frac = d.clock / 720;
    const night = smooth(0.67, 0.91, frac);
    sun.intensity = 2.1 + (0.5 - 2.1) * night;
    sun.color.set('#ffe1b0').lerp(new THREE.Color('#a6b8dc'), night);
    hemi.intensity = 0.9 - 0.45 * night;
    const elev = THREE.MathUtils.degToRad(48 + (12 - 48) * Math.min(1, Math.max(0, frac)));
    const az = THREE.MathUtils.degToRad(-35);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.copy(sun.target.position).addScaledVector(dir, 60);
    skyMat.uniforms.top.value.set('#8fb3bb').lerp(new THREE.Color('#3b4d6b'), night * 0.8);
    skyMat.uniforms.horizon.value.set('#eee7ce').lerp(new THREE.Color('#c9a98c'), night * 0.7);
    scene.fog.color.set('#d9dfcc').lerp(new THREE.Color('#8d8f99'), night * 0.6);
    sky.position.set(focus.x, 0, focus.z);
    lake.position.y = 0.09 + Math.sin(t * 0.9) * 0.012;
    for (const n of npcs) {
      n.visual.position.y = Math.sin(t + n.phase) * 0.025;
      n.visual.rotation.y = Math.sin(d.clock * 0.008 + n.phase) * 0.35;
    }
    for (const n of interactables) {
      n.phase += dt;
      if (n.ring.visible) n.ring.rotation.z += dt;
      if (n.kind === 'gather' && n.fruit) { n.fruit.visible = state.available(n.id); n.fruit.position.y = Math.sin(n.phase * 1.3) * 0.03; }
      if (n.kind === 'plot') updatePlot(n);
    }
  }
  function updatePlot(n) {
    const p = state.data.plots[n.id];
    if (n.soil) n.soil.material = S.mat(p && p.watered ? '#685d48' : '#87674e');
    let stage = -1;
    if (p) { stage = Math.min(3, Math.floor((p.growth / CROPS[p.crop].seconds) * 3)); if (!p.watered) stage = 0; }
    if (stage === n.lastStage) return;
    n.lastStage = stage;
    if (n.cropVisual) n.group.remove(n.cropVisual);
    n.cropVisual = new THREE.Group();
    n.group.add(n.cropVisual);
    if (stage < 0) return;
    for (let i = 0; i < 5; i++) {
      const x = ((i % 3) - 1) * 0.35; const z = (i / 3 - 0.5) * 0.4; const h = 0.15 + stage * 0.17;
      S.rod(n.cropVisual, [x, 0.08, z], [x, h, z], 0.035, '#6f8f50');
      S.ball(n.cropVisual, [x - 0.1, h * 0.7, z], [0.3, 0.1, 0.16], '#99b569');
      if (stage >= 2) S.ball(n.cropVisual, [x, h, z], [0.12 + stage * 0.04, 0.12 + stage * 0.04, 0.12 + stage * 0.04], ITEMS[p.crop].color);
    }
  }

  refresh();
  return { root, interactables, npcs, refresh, update, sun };
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** What the interact key does here, in words (the prompt). */
export function promptOf(n, state) {
  const d = state.data;
  switch (n.kind) {
    case 'gather': return state.available(n.id) ? `Gather ${ITEMS[n.item].name.toLowerCase()}` : 'Growing back · a little patience';
    case 'plot': {
      const p = d.plots[n.id];
      if (!p) return `Plant ${CROPS[state.selectedCrop].name} · ${d.seeds[state.selectedCrop] ?? 0} seeds`;
      if (!p.watered) return `Water ${CROPS[p.crop].name.toLowerCase()}`;
      if (p.growth >= CROPS[p.crop].seconds) return `Harvest ${CROPS[p.crop].name.toLowerCase()}`;
      return `${CROPS[p.crop].name} growing · ${Math.floor((100 * p.growth) / CROPS[p.crop].seconds)}%`;
    }
    case 'fish': return 'Cast a line · fishing';
    case 'npc': return `Talk to ${n.title}`;
    case 'animal': return `Care for ${n.title}`;
    case 'guardian': return `Read the ${n.title} guardian plaque`;
    case 'stall': return 'Open our fruit stall';
    case 'board': return 'Read village requests';
    case 'home': return 'Enter our treehouse';
    case 'home_menu': return 'Rest, store & decorate';
    case 'exit': return 'Return to the village';
    case 'upstairs': return 'Go upstairs · kitchen & bedroom';
    case 'downstairs': return 'Go downstairs · living room';
    case 'swan': return `Talk to ${n.title}`;
    default: return n.title;
  }
}
