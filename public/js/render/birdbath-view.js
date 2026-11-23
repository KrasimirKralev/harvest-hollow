// Bird baths (wave 4, owner wish 10: "rippling water and birds that land, splash and fly off"; wave 4b, wish 6: "now and
// then fly in, DRINK, splash and fly off"). Owned by the render lane. Every bird bath's water ripples, and two little
// birds take turns visiting it now and then: each flies in, lands on the rim, takes three sips (beak down, head back to
// swallow), hops into the basin for a fluttering bath, hops out, shakes itself and flies off. The schedule is a pure
// function of the server clock and the object id (birdVisit), so both screens see the same visit.
//
// Cost: ONE instanced draw for every bath on the farm (a flat ripple disc per bath and a camera-facing bird quad per
// visitor, told apart by a per-instance type); the motion is in the vertex shader (no per-frame JS per bird); JS only
// rebuilds the instance list when bird baths are placed, moved or sold, and fires the splash droplets of the visits
// near the view. Birds stay home at night and in the rain; Still motion freezes the water and keeps the birds away.
//
//   createBirdBaths({ layer, fx }) -> baths
//     baths.setState(state) / baths.sync(ids, topics, state)
//     baths.update(dt, nowMs, { night, rain, motion, focus: { x, z } }) -> 0 | 1
//     baths.stats() -> { baths, visible }     baths.warmup() -> [Object3D]
//   birdVisit(t, id, slot) -> { phase: 'in' | 'perch' | 'out' | 'away', k, at, act?, cycle, skipped? }   pure (tested)
//     act (perched): 'look' | 'drink' | 'bathe' | 'shake'; visits(cycle, seed) -> bool (now and then: 5 cycles in 7)
import * as THREE from 'three';
import { defOf } from '../../../shared/content/index.js';
import { TILE_M } from '../../../shared/content/config.js';
import { footprint } from '../../../shared/rules/grid.js';
import { models } from './models.js';

/** The visitors' sprite sheet: a blue tit, a robin and a goldfinch side by side (64 px each, beak to the right). */
function bathBirdTexture() {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 64;
  const g = c.getContext('2d');
  const birds = [
    { back: '#3F7FD0', head: '#2E5FB0', breast: '#FFD54A', cheek: '#FFFFFF', tail: '#2E4F8A' },      // blue tit
    { back: '#8A6440', head: '#7A5636', breast: '#F2703A', cheek: '#F2703A', tail: '#5E4228' },      // robin
    { back: '#C9A23A', head: '#E8463A', breast: '#FFE27A', cheek: '#FFFFFF', tail: '#2A2420' },      // goldfinch
  ];
  birds.forEach((b, i) => {
    const o = i * 64;
    g.fillStyle = b.tail; g.beginPath(); g.moveTo(o + 20, 38); g.lineTo(o + 4, 30); g.lineTo(o + 8, 44); g.fill();
    g.fillStyle = b.back; g.beginPath(); g.ellipse(o + 31, 38, 16, 13, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.breast; g.beginPath(); g.ellipse(o + 35, 43, 11, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.head; g.beginPath(); g.arc(o + 45, 27, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.cheek; g.beginPath(); g.ellipse(o + 46, 30, 5, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2A1A10'; g.beginPath(); g.moveTo(o + 54, 25); g.lineTo(o + 61, 28); g.lineTo(o + 54, 31); g.fill();
    g.beginPath(); g.arc(o + 48, 25, 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(o + 48.6, 24.4, 0.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.beginPath(); g.ellipse(o + 27, 36, 9, 6, -0.3, 0.2, 2.6); g.stroke();   // the wing
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One visit cycle (s; wave 4b, owner wish 6: birds "now and then fly in, DRINK, splash and fly off"): fly in 2.2, then on
 * the rim: a look round, three sips (beak down into the water, then the head tipped back to swallow), a hop into the
 * basin and a bath (wings fluttering, four splashes), a hop back to the rim and a shake, a last look round; fly off until
 * 15.2, then away. "Now and then": a visitor skips two cycles in seven (`skip`), decided by small-integer arithmetic that
 * every GPU and the JS side compute exactly alike, so both screens agree.
 */
export const VISIT = Object.freeze({ period: 34, inEnd: 2.2, perchEnd: 13, outEnd: 15.2,
  sips: Object.freeze([3.0, 4.3, 5.6]), hopIn: 6.8, hopOut: 10.4, bathe: Object.freeze([7.2, 10.4]),
  splashes: Object.freeze([7.45, 8.25, 9.05, 9.85]), shake: 11.0, skip: Object.freeze({ mul: 5, mod: 7, below: 2 }) });

/** FNV-1a of a string: a stable phase per bath on both screens. */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const phaseOf = (id, slot) => ((hashStr(`${id}:${slot}`) % 10000) / 10000) * VISIT.period + slot * VISIT.period * 0.5;
const seedOf = (id, slot) => hashStr(`${id}:s${slot}`) % VISIT.skip.mod;

/** Does cycle `c` of a visitor with this seed bring the bird? Integer arithmetic (the shader's twin, hhVisit). Pure. */
export function visits(c, seed) {
  const x = c * VISIT.skip.mul + seed;
  const r = x - VISIT.skip.mod * Math.floor((x + 0.5) / VISIT.skip.mod);
  return r >= VISIT.skip.below;
}

/** What a perched bird is doing `u` seconds into its cycle: 'look' | 'drink' | 'bathe' | 'shake' (pure). */
export function perchAct(u) {
  if (VISIT.sips.some((d) => u >= d && u < d + 1.1)) return 'drink';
  if (u >= VISIT.hopIn && u < VISIT.hopOut + 0.4) return 'bathe';
  if (u >= VISIT.shake && u < VISIT.shake + 0.7) return 'shake';
  return 'look';
}

/** Where visitor `slot` (0 | 1) of bath `id` is in its visit at server time `t` (seconds). Pure. */
export function birdVisit(t, id, slot = 0) {
  const tt = t + phaseOf(id, slot);
  const u = ((tt % VISIT.period) + VISIT.period) % VISIT.period;
  const cycle = Math.floor(tt / VISIT.period);
  if (!visits(cycle, seedOf(id, slot))) return { phase: 'away', k: 0, at: u, cycle, skipped: true };
  if (u < VISIT.inEnd) return { phase: 'in', k: u / VISIT.inEnd, at: u, cycle };
  if (u < VISIT.perchEnd) return { phase: 'perch', k: (u - VISIT.inEnd) / (VISIT.perchEnd - VISIT.inEnd), at: u, act: perchAct(u), cycle };
  if (u < VISIT.outEnd) return { phase: 'out', k: (u - VISIT.perchEnd) / (VISIT.outEnd - VISIT.perchEnd), at: u, cycle };
  return { phase: 'away', k: 0, at: u, cycle };
}

const f1 = (x) => x.toFixed(2);
const VS = /* glsl */`
uniform float uTime; uniform float uBirds; uniform float uStill;
attribute vec4 aPos;        // water centre xyz (metres), radius
attribute vec4 aBird;       // type (0 water, 1 bird), phase (s), perch angle, tint index + 3 x skip seed
varying vec2 vUv; varying float vType; varying float vSplash; varying float vR; varying float vVar; varying float vA;
const float P = ${f1(VISIT.period)};
// the visitor comes this cycle (exact small-integer maths: every GPU agrees with birdbath-view.js visits())
float hhVisit( float tt, float seed ) {
  float x = floor( tt / P ) * ${f1(VISIT.skip.mul)} + seed;
  float r = x - ${f1(VISIT.skip.mod)} * floor( ( x + 0.5 ) / ${f1(VISIT.skip.mod)} );
  return step( ${f1(VISIT.skip.below - 0.5)}, r );
}
float hhPulse( float u, float a ) { return exp( -max( 0.0, u - a ) * 2.4 ) * step( a, u ); }
// rings on the water: a small one after each sip, big ones while the bird bathes, a ripple when it hops in and out
float hhSplash( float u ) {
  float s = 0.0;
  ${VISIT.sips.map((d) => `s += 0.3 * hhPulse( u, ${f1(d + 0.3)} );`).join('\n  ')}
  ${VISIT.splashes.map((d) => `s += hhPulse( u, ${f1(d)} );`).join('\n  ')}
  s += 0.5 * hhPulse( u, ${f1(VISIT.hopIn + 0.4)} ) + 0.4 * hhPulse( u, ${f1(VISIT.hopOut)} );
  return s;
}
float hhWin( float u, float a, float b, float e ) { return smoothstep( a, a + e, u ) * ( 1.0 - smoothstep( b - e, b, u ) ); }
void main() {
  vUv = uv; vType = aBird.x; vR = aPos.w; vA = 1.0;
  float seed = floor( aBird.w / 3.0 + 0.01 );
  vVar = aBird.w - seed * 3.0;
  vSplash = 0.0;
  float tt = uTime + aBird.y;
  float u = mod( tt, P );
  float come = hhVisit( tt, seed );
  if ( aBird.x < 0.5 ) {
    // the water: a disc lying on the basin's surface; its rings follow both visitors (phases y and z, seeds in w)
    float s1 = floor( aBird.w / ${f1(VISIT.skip.mod)} + 0.01 ); float s0 = aBird.w - s1 * ${f1(VISIT.skip.mod)};
    float t1 = uTime + aBird.z;
    vSplash = hhSplash( u ) * hhVisit( tt, s0 ) + hhSplash( mod( t1, P ) ) * hhVisit( t1, s1 );
    vec3 p = aPos.xyz + vec3( position.x, 0.004, -position.y ) * aPos.w * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
    return;
  }
  if ( come < 0.5 || uBirds < 0.5 || uStill > 0.5 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vA = 0.0; return; }
  // a visitor: in from 7 m out and 4 m up along an arc, on the rim (sips, a bath in the basin, a shake), off the other way
  float a = aBird.z;
  vec3 rim = vec3( cos( a ), 0.0, sin( a ) );
  vec3 perch = aPos.xyz + rim * aPos.w * 0.92 + vec3( 0.0, 0.07, 0.0 );
  vec3 inner = aPos.xyz + rim * aPos.w * 0.3 - vec3( 0.0, 0.03, 0.0 );
  vec3 from = perch + vec3( cos( a + 0.7 ), 0.0, sin( a + 0.7 ) ) * 7.0 + vec3( 0.0, 4.0, 0.0 );
  vec3 to = perch + vec3( cos( a - 2.2 ), 0.0, sin( a - 2.2 ) ) * 8.0 + vec3( 0.0, 5.0, 0.0 );
  vec3 p; float fly = 0.0; float tilt = 0.0; float bathe = 0.0; float wig = 0.0;
  if ( u < ${f1(VISIT.inEnd)} ) { float k = u / ${f1(VISIT.inEnd)}; float e = 1.0 - ( 1.0 - k ) * ( 1.0 - k ); p = mix( from, perch, e ); p.y += sin( k * 3.14159 ) * 0.6; fly = 1.0; }
  else if ( u < ${f1(VISIT.perchEnd)} ) {
    // the hop into the basin and back out: along a little arc between the rim and the water near it
    float inW = smoothstep( ${f1(VISIT.hopIn)}, ${f1(VISIT.hopIn + 0.4)}, u ) * ( 1.0 - smoothstep( ${f1(VISIT.hopOut)}, ${f1(VISIT.hopOut + 0.4)}, u ) );
    p = mix( perch, inner, inW );
    p.y += sin( inW * 3.14159 ) * 0.14;
    // a hop on the rim now and then while it looks round
    p.y += max( 0.0, sin( u * 2.7 ) ) > 0.97 && inW < 0.01 ? 0.05 : 0.0;
    // the sips: the beak goes down into the water, then the head tips back to let it run down
    float sip = 0.0; float back = 0.0;
    ${VISIT.sips.map((d) => `sip += hhWin( u, ${f1(d)}, ${f1(d + 0.6)}, 0.25 ); back += hhWin( u, ${f1(d + 0.6)}, ${f1(d + 1.1)}, 0.15 );`).join('\n    ')}
    p.y -= sip * 0.05;
    // the bath: low in the water, wings a blur, the body rocking; then a shake on the rim
    bathe = hhWin( u, ${f1(VISIT.bathe[0])}, ${f1(VISIT.bathe[1])}, 0.15 );
    p.y += bathe * ( abs( sin( uTime * 17.0 ) ) * 0.035 - 0.02 );
    wig = hhWin( u, ${f1(VISIT.shake)}, ${f1(VISIT.shake + 0.7)}, 0.08 ) * sin( uTime * 46.0 ) * 0.32;
    tilt = sip * 0.95 - back * 0.4;
    tilt += bathe * sin( uTime * 21.0 ) * 0.18;
  } else if ( u < ${f1(VISIT.outEnd)} ) { float k = ( u - ${f1(VISIT.perchEnd)} ) / ${f1(VISIT.outEnd - VISIT.perchEnd)}; p = mix( perch, to, k * k ); p.y += sin( k * 3.14159 ) * 0.4; fly = 1.0; vA = 1.0 - smoothstep( 0.75, 1.0, k ); }
  else { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); vA = 0.0; return; }
  // which way it heads on screen: the sprite's beak points right, so mirror it when it moves left
  vec3 ahead = u < ${f1(VISIT.inEnd)} ? perch - from : u < ${f1(VISIT.perchEnd)} ? aPos.xyz - perch : to - perch;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  float dir = sign( ( modelViewMatrix * vec4( ahead, 0.0 ) ).x + 1e-4 );
  float flap = fly > 0.5 ? 0.7 + 0.3 * abs( sin( uTime * 28.0 ) ) : 1.0 - bathe * 0.28 * abs( sin( uTime * 38.0 ) );
  float spread = 1.0 + bathe * 0.22 * abs( sin( uTime * 38.0 + 1.0 ) );
  // a positive tilt dips the beak (it points along +x times dir): rotate clockwise on screen for a right-facing bird
  float ang = -tilt * dir + wig;
  vec2 q = vec2( position.x * dir * spread, position.y * flap );
  q = vec2( q.x * cos( ang ) - q.y * sin( ang ), q.x * sin( ang ) + q.y * cos( ang ) );
  mv.xy += q * 0.5 + vec2( 0.0, 0.16 );
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
uniform sampler2D uMap; uniform float uTime; uniform float uStill;
varying vec2 vUv; varying float vType; varying float vSplash; varying float vR; varying float vVar; varying float vA;
void main() {
  if ( vType < 0.5 ) {
    vec2 c = vUv - 0.5; float r = length( c ) * 2.0;
    if ( r > 1.0 ) discard;
    float t = uStill > 0.5 ? 0.0 : uTime;
    // slow rings drifting out, a shimmer, and bright splash rings after each sip and splash
    float rings = 0.5 + 0.5 * sin( r * 22.0 - t * 2.6 );
    float splash = min( 1.4, vSplash ) * ( 0.5 + 0.5 * sin( r * 30.0 - t * 9.0 ) ) * smoothstep( 1.0, 0.2, r );
    float a = ( rings * 0.12 + splash * 0.45 ) * smoothstep( 1.0, 0.75, r );
    gl_FragColor = vec4( vec3( 0.9, 0.97, 1.0 ), a );
    return;
  }
  vec4 tx = texture2D( uMap, vec2( ( vUv.x + floor( vVar + 0.5 ) ) / 3.0, vUv.y ) );
  if ( tx.a < 0.45 || vA < 0.01 ) discard;
  gl_FragColor = vec4( tx.rgb, vA );
  #include <colorspace_fragment>
}`;

// the water a visit throws (JS fires them for the baths near the view; the shader draws the bird and the rings)
const SIP = Object.freeze({ n: 2, color: '#D6F1FF', speed: 0.25, up: 0.6, size: 0.05, grav: 0.9, life: 0.3, spread: 0.03, ambient: true });
const SPLASH = Object.freeze({ n: 7, colors: ['#D6F1FF', '#FFFFFF', '#A9DDF2'], speed: 1.0, up: 1.6, size: 0.075, grav: 0.9, life: 0.5, spread: 0.1, ambient: true });
const SHAKE = Object.freeze({ n: 5, color: '#E4F4FF', speed: 1.3, up: 0.7, size: 0.055, grav: 0.9, life: 0.35, spread: 0.04, ambient: true });
/** [time in the cycle (s), 0 sip | 1 splash | 2 shake]: the moments water flies, in order. */
const SPRAY = Object.freeze([...VISIT.sips.map((d) => [d + 0.3, 0]), ...VISIT.splashes.map((d) => [d, 1]), [VISIT.shake + 0.1, 2]]
  .sort((a, b) => a[0] - b[0]));

export function createBirdBaths({ layer, fx = null } = {}) {
  let baths = [];                  // [{ id, x, y, z, r }]
  let mesh = null;
  let cap = 0;
  const uniforms = { uTime: { value: 0 }, uBirds: { value: 1 }, uStill: { value: 0 }, uMap: { value: null } };
  const v3 = new THREE.Vector3();

  function material() {
    if (!uniforms.uMap.value && typeof document !== 'undefined') uniforms.uMap.value = bathBirdTexture();
    // double-sided: a bird heading left is its quad mirrored on screen (x * dir), which turns its winding round; one-sided,
    // every visitor flying or facing left was culled (wave 4b fix: half the visits never showed)
    return new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  function build(n) {
    cap = Math.max(4, n);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('aBird', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; return; }
    mesh = new THREE.Mesh(geo, material());
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.name = 'birdbaths';
    mesh.visible = false;
    layer.add(mesh);
  }

  function collect(state) {
    const out = [];
    const objs = state && state.farm && state.farm.objects;
    if (!objs) return out;
    for (const id of Object.keys(objs).sort()) {
      const o = objs[id];
      if (!o || !Number.isFinite(o.x)) continue;
      const def = defOf(o.def);
      if (!def || def.kind !== 'decor') continue;
      const key = models.keyOf(o.def);
      const w = key ? models.info(key)?.anchors?.water : null;
      if (!Array.isArray(w) || w.length !== 4) continue;
      const [fw, fd] = footprint(def, o.rot || 0);
      const cx = (o.x + fw / 2) * TILE_M; const cz = (o.z + fd / 2) * TILE_M;
      const yaw = (o.rot || 0) * (Math.PI / 2); const c = Math.cos(yaw); const s = Math.sin(yaw);
      out.push({ id, x: cx + w[0] * c + w[2] * s, y: w[1], z: cz - w[0] * s + w[2] * c, r: w[3],
        phase: [phaseOf(id, 0), phaseOf(id, 1)], seed: [seedOf(id, 0), seedOf(id, 1)], ang: [0, 1].map((sl) => (hashStr(`${id}:a${sl}`) % 628) / 100),
        splashed: [-1, -1] });
    }
    return out;
  }

  function fill() {
    const n = baths.length * 3;
    if (!n) { if (mesh) mesh.visible = false; return; }
    if (!mesh || n > cap) build(n);
    const P = mesh.geometry.getAttribute('aPos'); const B = mesh.geometry.getAttribute('aBird');
    let i = 0;
    for (const b of baths) {
      for (let k = 0; k < 3; k++) {
        P.setXYZW(i, b.x, b.y, b.z, b.r);
        // the water (type 0) carries both visitors' phases and skip seeds, so its rings follow whichever bird is in it;
        // a visitor packs its tint (0..2) and its seed (0..6) as tint + 3 x seed
        const slot = k === 2 ? 1 : 0;
        if (k === 0) B.setXYZW(i, 0, b.phase[0], b.phase[1], b.seed[0] + VISIT.skip.mod * b.seed[1]);
        else B.setXYZW(i, 1, b.phase[slot], b.ang[slot], (hashStr(`${b.id}:t${slot}`) % 3) + 3 * b.seed[slot]);
        i++;
      }
    }
    mesh.geometry.instanceCount = i;
    P.needsUpdate = true; B.needsUpdate = true;
    // frustum culling over every bath (and the visitors' flight paths, ~9 m out): off screen, no draw call at all
    const box = new THREE.Box3();
    for (const b of baths) box.expandByPoint(v3.set(b.x, b.y, b.z));
    const sph = box.getBoundingSphere(new THREE.Sphere());
    sph.radius += 9;
    mesh.geometry.boundingSphere = sph;
    mesh.frustumCulled = true;
  }

  return {
    setFx(f) { fx = f; },
    setState(state) { baths = collect(state); fill(); },
    sync(ids, topics, state) {
      if (topics.has('*') || topics.has('objects')) {
        const next = collect(state);
        const sig = (l) => l.map((b) => `${b.id}@${b.x.toFixed(2)},${b.z.toFixed(2)}`).join('|');
        if (sig(next) !== sig(baths)) { baths = next; fill(); }
      }
    },
    /** Per tick: the shader's clock (server seconds: both screens agree), who may visit, the splashes near the view. */
    update(dt, nowMs, { night = 0, rain = 0, motion = 'full', focus = null } = {}) {
      if (!mesh || !baths.length) return 0;
      const t = (nowMs / 1000) % 100000;
      uniforms.uTime.value = t;
      uniforms.uBirds.value = night < 0.5 && rain < 0.3 ? 1 : 0;
      uniforms.uStill.value = motion === 'still' ? 1 : 0;
      mesh.visible = true;
      // the water a visit throws, for the baths near the view (the shader shows the sip, the bath and the shake)
      if (fx && uniforms.uBirds.value > 0.5 && motion === 'full' && focus) {
        for (const b of baths) {
          if (Math.abs(b.x - focus.x) > 30 || Math.abs(b.z - focus.z) > 30) continue;
          for (let slot = 0; slot < 2; slot++) {
            // (inline birdVisit: no objects per tick) where this visitor is in its cycle, and whether it came at all
            const tt = t + b.phase[slot];
            const at = ((tt % VISIT.period) + VISIT.period) % VISIT.period;
            if (at < VISIT.inEnd || at >= VISIT.perchEnd) continue;
            const cyc = Math.floor(tt / VISIT.period);
            if (!visits(cyc, b.seed[slot])) continue;
            for (let k = 0; k < SPRAY.length; k++) {
              const [d, kind] = SPRAY[k];
              if (at < d || at > d + 0.3) continue;
              const tag = cyc * 16 + k;
              if (b.splashed[slot] === tag) continue;
              b.splashed[slot] = tag;
              // a sip and the shake at the rim, the bath's splashes in the water near it
              const r = kind === 1 ? b.r * 0.3 : b.r * 0.85;
              v3.set(b.x + Math.cos(b.ang[slot]) * r, b.y + (kind === 2 ? 0.12 : 0), b.z + Math.sin(b.ang[slot]) * r);
              fx.burst('droplet', v3, kind === 0 ? SIP : kind === 1 ? SPLASH : SHAKE);
            }
          }
        }
      }
      return motion === 'still' ? 0 : 1;
    },
    stats() { return { baths: baths.length, visible: Boolean(mesh && mesh.visible) }; },
    warmup() {
      if (!mesh) build(4);
      const was = mesh.visible; mesh.visible = true;
      return [{ removeFromParent() { mesh.visible = was && baths.length > 0; } }];
    },
  };
}
