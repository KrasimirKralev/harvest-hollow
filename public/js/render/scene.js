// Scene graph layers, lights, sky dome, distant hills and the decorative world around the farm (tech §10.2,
// visual-ux-juice §3.5, §4.6; GDD §2.1-2.2, §8.1, §8.4). Owned by the render-world lane.
//
//   createScene() -> { scene, layers, sun, hemi, sky, hills, fireflies }
//     sky.set(skyState)      daynight.js pushes the colours, sun/moon direction and night amount
//     sun                    the one shadow-casting DirectionalLight (static shadow cache, see index.js)
//   buildBackdrop(scenery, { quality, far }) -> { count, far }
//     the forest wall framing the clearing (visual-01): measured from the land the farm owns or can buy (every
//     live expansion), 3-5 rows of tall pines with overlapping crowns, rock outcrops, then mixed pines and round
//     trees, thinning into the hills; reeds on the river banks, lily pads on the lake, a wooden bridge and the
//     Hollow Village across the river. Deterministic (hashes, no Math.random). The near edge goes into the
//     shadow-casting `scenery` batch, everything farther than 20 m into `far` (no shadow pass).
//   forestSpot(x, z, rects) -> { d, row } | null   where a forest cell may stand (pure, tested)
import * as THREE from 'three';
import { TILE_M, WORLD_TILES, FARM_MIN, FARM_MAX } from '../../../shared/content/config.js';
import { heightAt, noise2, riverZ, riverHalf, LAKE, WATER_Y, ROAD_Z, BRIDGE_X, liveRects, liveUnionDist, padMask } from './ground.js';
import { WORLD } from './world-uniforms.js';
import { COTTAGES, TOWN_SLOTS, SQUARE, PAVILION_SLOT } from './town-view.js';
import { inFeatureZone } from './land-features.js';

const W = WORLD_TILES * TILE_M;
const CX = W / 2;

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
// forest rocks lean warm grey with a restrained moss (visual-after A9: #969080 / #69784A)
const ROCK = new THREE.Color(1.02, 0.97, 0.88);

function hash(i, k) {
  let h = Math.imul(i | 0, 2654435761) ^ Math.imul(k | 0, 1597334677);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------
function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color('#4FA8EE') },
    uHorizon: { value: new THREE.Color('#D6F1FF') },
    uBelow: { value: new THREE.Color('#C9E3D8') },
    uSunDir: { value: new THREE.Vector3(-0.55, 0.75, 0.25).normalize() },
    uSunColor: { value: new THREE.Color('#FFF4D6') },
    uNight: { value: 0 },
    uCloud: { value: 0.3 },
    uTime: WORLD.uTime,
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBelow;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uNight;
      uniform float uCloud;
      uniform float uTime;
      varying vec3 vDir;
      float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float vn( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y );
      }
      void main() {
        vec3 d = normalize( vDir );
        float up = max( d.y, 0.0 );
        vec3 col = mix( uHorizon, uTop, pow( up, 0.5 ) );
        col = mix( col, uBelow, smoothstep( 0.0, -0.12, d.y ) );
        float s = max( dot( d, normalize( uSunDir ) ), 0.0 );
        // sun by day, a pale moon by night
        col += uSunColor * ( pow( s, 900.0 ) * 2.5 + pow( s, 14.0 ) * 0.22 ) * ( 1.0 - uNight );
        col += vec3( 0.85, 0.9, 1.0 ) * smoothstep( 0.9993, 0.9996, s ) * uNight * 1.2;
        // stars
        vec2 sp = vec2( atan( d.z, d.x ) * 60.0, d.y * 90.0 );
        float st = step( 0.985, h21( floor( sp ) ) ) * smoothstep( 0.05, 0.3, d.y );
        col += vec3( 0.9, 0.92, 1.0 ) * st * uNight * ( 0.6 + 0.4 * sin( uTime * 2.0 + h21( floor( sp ) ) * 30.0 ) );
        // soft cumulus band near the horizon, drifting slowly
        vec2 cp = vec2( atan( d.z, d.x ) * 3.2 + uTime * 0.004, d.y * 9.0 );
        float c = vn( cp * 1.7 ) * 0.6 + vn( cp * 4.1 ) * 0.3 + vn( cp * 9.0 ) * 0.1;
        float band = smoothstep( 0.02, 0.1, d.y ) * ( 1.0 - smoothstep( 0.18, 0.42, d.y ) );
        float cloud = smoothstep( 0.52 - uCloud * 0.18, 0.78, c ) * band;
        vec3 cloudCol = mix( uHorizon * 1.08, vec3( 1.0 ), 0.55 ) * mix( vec3( 1.0 ), uSunColor, 0.25 );
        col = mix( col, cloudCol, cloud * 0.85 );
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  // drawn after the opaque world and the terrain (1) at the far plane: only uncovered pixels pay for the sky
  mesh.renderOrder = 2;
  return {
    mesh,
    uniforms,
    /** Apply a daynight.js sky state. */
    set(s) {
      uniforms.uTop.value.setRGB(...s.top);
      uniforms.uHorizon.value.setRGB(...s.horizon);
      uniforms.uBelow.value.setRGB(s.fog[0] * 0.92, s.fog[1] * 0.96, s.fog[2] * 0.9);
      uniforms.uSunDir.value.set(...s.sunDir);
      uniforms.uSunColor.value.setRGB(...s.sunColor);
      uniforms.uNight.value = s.night;
    },
  };
}

/** A ring of soft blue-green hills far away: the horizon when the camera tilts low. */
function createHills() {
  const seg = 96;
  const rings = [260, 330];         // the painted strip (createPaintedHills) is the far ring
  const pos = [];
  const col = [];
  const idx = [];
  const near = new THREE.Color('#6E9E62');
  const far = new THREE.Color('#9DBFC8');
  rings.forEach((r, ri) => {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = noise2(Math.cos(a) * 3 + ri * 7, Math.sin(a) * 3) * 0.7 + noise2(Math.cos(a) * 9, Math.sin(a) * 9 + ri) * 0.3;
      const h = (18 + ri * 14) * (0.35 + n) ;
      const x = CX + Math.cos(a) * r;
      const z = CX + Math.sin(a) * r;
      pos.push(x, -2, z, x, h, z);
      const c = near.clone().lerp(far, ri / (rings.length - 1));
      col.push(c.r * 0.8, c.g * 0.8, c.b * 0.8, c.r, c.g, c.b);
    }
    const base = ri * (seg + 1) * 2;
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.name = 'hills';
  m.matrixAutoUpdate = false;
  return m;
}

/** The art lane's painted ridge strip as the far horizon ring: one draw. RD-18 (QA wave 2): a 2048-px-wide copy
 *  (public/assets/textures/horizon-hills-2048.webp, resampled from assets/art/horizon-hills.webp): the 4096 x 962
 *  original took 20 MB of GPU memory with its mipmaps and is indistinguishable at this distance. */
export const HILLS_TEXTURE = '/assets/textures/horizon-hills-2048.webp';
function createPaintedHills(R = 470, repeats = 6) {
  const build = typeof document !== 'undefined' ? document.querySelector('meta[name="hh-build"]')?.content : null;
  const tex = new THREE.TextureLoader().load(`${HILLS_TEXTURE}${build ? `?v=${build}` : ''}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.MirroredRepeatWrapping;        // an even `repeats` makes the 360° wrap meet on a mirror line
  tex.repeat.set(repeats, 1);
  tex.anisotropy = 4;
  const H = (2 * Math.PI * R / repeats) / (2048 / 481); // keep the painting's aspect
  const geo = new THREE.CylinderGeometry(R, R, H, 96, 1, true);
  geo.translate(CX, H * 0.5 - H * 0.3, CX);          // sunk 30 %: the ridge tops sit about 10° above the horizon
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'paintedHills';
  m.renderOrder = -1;
  m.matrixAutoUpdate = false;
  return m;
}

/** Fireflies over the meadows at night (GDD §8.4): one instanced draw, animated on the GPU, dark by day. */
function createFireflies(n = 160) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const a = new Float32Array(n * 4);
  let k = 0;
  for (let i = 0; k < n && i < n * 20; i++) {
    // along the farm's wild edges and over the land beyond the fence
    const x = -6 + hash(i, 71) * (W + 12);
    const z = -6 + hash(i, 72) * (W - 4);
    const inner = x > 30 && x < 98 && z > 40 && z < 88;
    if (inner && hash(i, 73) > 0.15) continue;
    a.set([x, 0.6 + hash(i, 74) * 1.6, z, hash(i, 75) * 100], k * 4);
    k++;
  }
  geo.setAttribute('aFly', new THREE.InstancedBufferAttribute(a, 4));
  geo.instanceCount = k;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: WORLD.uTime, uNight: WORLD.uNight },
    vertexShader: /* glsl */`
      attribute vec4 aFly;
      uniform float uTime;
      varying vec2 vUv;
      varying float vA;
      void main() {
        vUv = uv;
        float t = uTime * 0.35 + aFly.w;
        vec3 p = aFly.xyz + vec3( sin( t * 1.3 ) * 1.6 + sin( t * 0.4 ) * 2.0, sin( t * 2.1 ) * 0.35, cos( t * 1.1 ) * 1.6 );
        // each fly blinks on its own slow, irregular rhythm
        vA = smoothstep( 0.25, 1.0, sin( uTime * ( 1.4 + fract( aFly.w * 0.37 ) * 1.6 ) + aFly.w * 7.0 ) * 0.5 + 0.5 );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        // screen-stable: a 2-3 px core in an 8-14 px halo at every zoom (visual-15)
        mv.xy += position.xy * ( -mv.z * ( 0.0068 + fract( aFly.w * 0.71 ) * 0.0035 ) );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float r = length( vUv - 0.5 ) * 2.0;
        float halo = pow( max( 0.0, 1.0 - r ), 2.0 ) * 0.6;
        float core = smoothstep( 0.24, 0.12, r );
        float a = ( halo + core ) * vA * uNight;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( mix( vec3( 1.0, 0.86, 0.35 ), vec3( 1.0, 0.98, 0.8 ), core ) * a, a );
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fireflies';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  return mesh;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog('#D6F1FF', 150, 420);
  const layers = {};
  for (const name of ['sky', 'terrain', 'ground', 'gridFx', 'crops', 'objects', 'animals', 'avatars', 'badges', 'fx', 'ui3d']) {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    layers[name] = g;
  }
  const sky = createSky();
  layers.sky.add(sky.mesh);
  const hills = createHills();
  layers.sky.add(hills);
  const painted = createPaintedHills();
  layers.sky.add(painted);
  // dusk and night must not leave the painted strip in daylight: tint it with the sky state
  const tint = new THREE.Color();
  const setSky = sky.set;
  sky.set = (st) => {
    setSky(st);
    painted.material.color.setRGB(1, 1, 1).lerp(tint.setRGB(st.fog[0], st.fog[1], st.fog[2]), 0.35)
      .multiplyScalar(1 - 0.55 * (st.night ?? 0));
  };
  const fireflies = createFireflies();
  layers.fx.add(fireflies);
  const hemi = new THREE.HemisphereLight('#CFE8FF', '#8C7A4B', 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#FFF1D6', 2.8);
  sun.position.set(-50, 70, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.shadow.intensity = 0.62;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
  scene.add(sun, sun.target);
  return { scene, layers, sun, hemi, sky, hills, fireflies };
}

// ---------------------------------------------------------------------------------------------------
// The decorative world (static scenery batch)
const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const vv = new THREE.Vector3();
const ss = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function place(batch, key, x, z, yaw, s, y = null, color = null, sy = 1) {
  qq.setFromAxisAngle(Y, yaw);
  ss.set(s, s * sy, s);
  m4.compose(vv.set(x, y === null ? heightAt(x, z) - 0.05 : y, z), qq, ss);
  return batch.add(key, m4, color);
}

/** Where a forest tree may stand: its distance to the live land and its row band, or null (pure). */
export function forestSpot(x, z, rects) {
  const farm0 = FARM_MIN * TILE_M;
  const farm1 = FARM_MAX * TILE_M;
  const d = liveUnionDist(x, z, rects);
  if (d < 2.5 || d > 75) return null;                                   // a setback for the fence; fog beyond
  if (z > farm1 + 2 && x > farm0 - 8 && x < farm1 + 8) return null;      // the lane, the river and the village
  if (Math.abs(z - ROAD_Z) < 5) return null;
  if (padMask(x, z, 3) > 0) return null;                                // the world places' clearings (fair, meadow ...)
  if (inFeatureZone(x, z)) return null;                                 // the M2 land features grow their own (land-features.js)
  if (heightAt(x, z) < -0.15) return null;                              // river channel, lake hollow and banks
  return { d, row: d < 14 ? 'edge' : d < 30 ? 'mixed' : 'far' };
}

/** Fill the decorative ring. Returns the instance counts. */
export function buildBackdrop(scenery, { quality = 'high', far: farBatch = null, mid: midBatch = null } = {}) {
  const farm0 = FARM_MIN * TILE_M;
  const farm1 = FARM_MAX * TILE_M;
  const density = quality === 'low' ? 0.6 : quality === 'medium' ? 0.82 : 1;
  const rects = liveRects();
  const haze = new THREE.Color('#C9DDE8');
  const tint = new THREE.Color();
  let n = 0;
  let n2 = 0;
  let nFar = 0;
  const CELL = 4.2;
  for (let gz = -80; gz < W + 90; gz += CELL) {
    for (let gx = -90; gx < W + 90; gx += CELL) {
      const i = Math.round(gx * 7 + gz * 131);
      const x = gx + (hash(i, 1) - 0.5) * CELL * 0.9;
      const z = gz + (hash(i, 2) - 0.5) * CELL * 0.9;
      const spot = forestSpot(x, z, rects);
      if (!spot) continue;
      const { d } = spot;
      // groves (visual-after A2): a low-frequency field gathers the mixed and far rows into stands of 5-9 trees with
      // clearings between them; the wall right behind the fence stays dense, with a shallow bay now and then
      const grove = noise2(x * 0.055 + 3.1, z * 0.055 - 7.7);
      const gk = spot.row === 'edge' ? 0.72 + 0.4 * smooth(0.22, 0.48, grove) : 1.3 * smooth(0.3, 0.52, grove);
      const p = Math.min(1, (spot.row === 'edge' ? 0.94 : spot.row === 'mixed' ? 0.8 : 0.62 - Math.min(1, (d - 30) / 45) * 0.36) * gk) * density;
      if (hash(i, 3) > p) continue;
      const r = hash(i, 4);
      const yaw = hash(i, 5) * Math.PI * 2;
      // the outer rows sit in a cooler, quieter distance haze (up to 16 %): depth without fog on the farm itself
      const hz = Math.min(1, Math.max(0, (d - 12) / 36)) * 0.16;
      const col = hz > 0 ? tint.setRGB(1, 1, 1).lerp(haze, hz) : null;
      // the wall (d <= 8 m) casts shadows onto the farm; the rows behind it draw without casting (RD-13)
      const batch = d > 20 && farBatch ? farBatch : d > 8 && midBatch ? midBatch : scenery;
      // a grove's heart grows taller than its rim: heights vary 0.7-1.6x and read as stands, not a carpet
      const tall = 0.85 + 0.35 * smooth(0.35, 0.75, grove);
      let key; let s; let sy = 1; let rc = col;
      if (spot.row === 'edge') {
        // the wall: tall pines, a round tree now and then, bushes and low rock outcrops at its foot
        if (d < 9 && r > 0.88) { key = hash(i, 8) < 0.6 ? 'debris:boulder' : 'debris:rock'; s = key === 'debris:boulder' ? 0.5 + hash(i, 9) * 0.3 : 0.8 + hash(i, 9) * 0.5; sy = 0.78; rc = ROCK; }
        else if (d < 5.5 && r > 0.72) { key = `prop:bush_${1 + Math.floor(hash(i, 8) * 2)}`; s = 1.1 + hash(i, 9) * 0.5; }
        else if (r < 0.16) { key = `prop:forest_round_${1 + Math.floor(hash(i, 7) * 3)}`; s = (0.95 + hash(i, 6) * 0.35) * tall; }
        else { key = `prop:forest_pine_${1 + Math.floor(hash(i, 7) * 2)}`; s = (1.05 + hash(i, 6) * 0.5) * tall; }
      } else if (spot.row === 'mixed') {
        if (r < 0.38) { key = `prop:forest_round_${1 + Math.floor(hash(i, 7) * 3)}`; s = (0.8 + hash(i, 6) * 0.5) * tall; }
        else { key = `prop:forest_pine_${1 + Math.floor(hash(i, 7) * 2)}`; s = (0.8 + hash(i, 6) * 0.6) * tall; }
      } else {
        key = r < 0.2 ? `prop:forest_round_${1 + Math.floor(hash(i, 7) * 3)}` : `prop:forest_pine_${1 + Math.floor(hash(i, 7) * 2)}`;
        s = (0.85 + hash(i, 6) * 0.6) * tall;
      }
      place(batch, key, x, z, yaw, s, null, rc, sy);
      if (batch !== farBatch) n++; else nFar++;
      // an outcrop: a broad low rock with two or three smaller stones at its base, about every 18 m along the edge
      // (visual-after A9: no tall striped monoliths)
      if (spot.row === 'edge' && d < 8 && hash(i, 10) < 0.13) {
        for (let k = 0; k < 2 + (hash(i, 11) < 0.5 ? 1 : 0); k++) {
          const a = hash(i, 12 + k) * Math.PI * 2;
          // the squat grey boulder with its moss cap is the one rock the farm already loves (visual-after: keep)
          place(scenery, k === 0 ? 'debris:boulder' : 'debris:rock', x + Math.cos(a) * 1.5, z + Math.sin(a) * 1.5, a, k === 0 ? 0.55 + hash(i, 15) * 0.25 : 0.55 + hash(i, 15 + k) * 0.4, null, ROCK, 0.8);
          n++;
        }
      }
    }
  }
  void farm0;
  // Reeds along both river banks and around the lake.
  for (let i = 0; i < 160; i++) {
    const x = -60 + hash(i, 31) * 260;
    const side = hash(i, 32) < 0.5 ? -1 : 1;
    const z = riverZ(x) + side * (riverHalf(x) - 0.2 + hash(i, 33) * 1.4);
    const h = heightAt(x, z);
    if (h < WATER_Y - 0.5 || h > WATER_Y + 0.6) continue;
    if (Math.abs(x - BRIDGE_X) < 4) continue;
    place(midBatch || scenery, 'prop:reeds', x, z, hash(i, 34) * 6.28, 0.9 + hash(i, 35) * 0.7, Math.max(h, WATER_Y) - 0.1);
    n++;
  }
  // RD-10 (QA wave 2): reed and stone groups at the waterline every 4-8 m along both banks (a broken bank silhouette),
  // clear of the bridge, the jetty, the ferry landing, the mill and the greenhouse ruin
  const busy = [[BRIDGE_X, 6], [46, 6], [84, 6], [100, 6], [29, 7]];
  for (const side of [-1, 1]) {
    for (let x = -50, k = 0; x < 200; x += 4 + hash(k, 91 + side) * 4, k++) {
      if (busy.some(([bx, r]) => Math.abs(x - bx) < r)) continue;
      // the waterline on this bank: walk out from the channel until the ground is above the water
      const rz = riverZ(x);
      let z = rz;
      for (let t = 0; t < 26; t += 0.25) { z = rz + side * t; if (heightAt(x, z) > WATER_Y) break; }
      const n = 2 + Math.floor(hash(k, 93 + side) * 2);
      for (let j = 0; j < n; j++) {
        const rx = x + (hash(k * 7 + j, 95) - 0.5) * 1.6; const rzz = z - side * (0.2 + hash(k * 7 + j, 96) * 0.7);
        const h = heightAt(rx, rzz);
        place(midBatch || scenery, 'prop:reeds', rx, rzz, hash(k * 7 + j, 97) * 6.28, 0.8 + hash(k * 7 + j, 98) * 0.6, Math.max(h, WATER_Y) - 0.1);
        n2++;
      }
      if (hash(k, 99 + side) < 0.7) {
        for (let j = 0; j < 1 + (hash(k, 101) < 0.4 ? 1 : 0); j++) {
          const sx = x + 0.9 + j * 0.7; const sz = z + side * (0.1 + j * 0.25);
          place(midBatch || scenery, 'debris:rock', sx, sz, hash(k, 103 + j) * 6.28, 0.3 + hash(k, 105 + j) * 0.2, Math.max(heightAt(sx, sz), WATER_Y - 0.15) - 0.12, ROCK, 0.7);
          n2++;
        }
      }
    }
  }
  n += n2;
  for (let i = 0; i < 70; i++) {
    const a = hash(i, 41) * Math.PI * 2;
    const r = LAKE.r * (0.9 + hash(i, 42) * 0.35);
    const x = LAKE.x + Math.cos(a) * r;
    const z = LAKE.z + Math.sin(a) * r / 1.25;
    const h = heightAt(x, z);
    if (h < WATER_Y - 0.5 || h > WATER_Y + 0.7) continue;
    place(midBatch || scenery, 'prop:reeds', x, z, hash(i, 43) * 6.28, 0.9 + hash(i, 44) * 0.6, Math.max(h, WATER_Y) - 0.1);
    n++;
  }
  // Lily pads on the lake.
  for (let i = 0; i < 26; i++) {
    const a = hash(i, 51) * Math.PI * 2;
    const r = LAKE.r * (0.25 + hash(i, 52) * 0.6);
    const x = LAKE.x + Math.cos(a) * r;
    const z = LAKE.z + Math.sin(a) * r / 1.25;
    if (heightAt(x, z) > WATER_Y - 0.4) continue;
    place(scenery, 'prop:lilypad', x, z, hash(i, 53) * 6.28, 0.8 + hash(i, 54) * 0.6, WATER_Y + 0.02);
    n++;
  }
  // The bridge over the river and the Hollow Village's buildings live in restoration-view.js and town-view.js
  // (they change with the Stone Bridge and the Town Projects); here: the village's trees, clear of every cottage,
  // landmark spot and the main street.
  const village = farBatch || scenery;
  const taken = [...COTTAGES.map(([x, z]) => [x, z, 6.5]), ...Object.values(TOWN_SLOTS).map(([x, z, , sc]) => [x, z, 7.5 * Math.max(1, sc || 1)]),
    ...SQUARE.map(([, x, z]) => [x, z, 3]), [PAVILION_SLOT[0], PAVILION_SLOT[1], 8.5]];
  for (let i = 0; i < 70; i++) {
    const x = 6 + hash(i, 61) * 130;
    const z = 150 + hash(i, 62) * 58;
    if (heightAt(x, z) < WATER_Y + 0.6) continue;
    if (taken.some(([cx, cz, r]) => Math.hypot(cx - x, cz - z) < r)) continue;
    if (Math.abs(x - BRIDGE_X) < 4.5) continue;
    // a few big shade trees in the village, the rest round its edge
    const edge = z > 186 || x < 18 || x > 120;
    if (!edge && hash(i, 66) < 0.55) continue;
    place(village, hash(i, 63) < 0.55 ? `prop:forest_round_${1 + (i % 3)}` : 'prop:forest_pine_2', x, z, hash(i, 64) * 6.28, 0.75 + hash(i, 65) * 0.45);
    nFar++;
  }
  return { count: n, far: nFar };
}

export { CX as WORLD_CENTER };
