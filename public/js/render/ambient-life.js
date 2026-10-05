// Ambient life (visual-ux-juice §3.5, §3.7, §3.10; GDD §8.4; RD-39): the small things that make the farm feel
// alive while nobody clicks: butterflies over the flowers, birds perched on the fence that fly off when a
// cursor comes near and land again, a hot-air balloon drifting across the sky about every 10 minutes, a rainbow
// for a minute after the rain, dust motes and a soft vignette in Golden Hour, glints on the winter snow, and the
// wind chimes swinging when hovered. Everything is cosmetic, ambient (it never asks for the interactive frame
// rate), and off under Still. Shared moments (the balloon, the rainbow) come from server time so both screens
// agree. Owned by the render lane.
//
//   createAmbientLife(layers, { now, overlay }) -> life
//     life.setFx(fx) / life.setState(state) / life.sync(ids, topics, state)
//     life.setBeauty({ score, stars }, completeSets?)   Farm Beauty ambience (wave 2, GDD §5.9): more butterflies (4 + 2
//                                           per star, up to 16, and a cloud over every complete Cottage Garden), sparkles
//                                           drifting off the prettiest decor by day (none below 1 star)
//     life.setSky(sky, weather, gold)       the daynight state, the weather levels and the Golden Hour amount
//     life.setFarmers(fn() -> [{ x, z }])  where the farmers stand (metres): Golden Hour's motes gather round them
//     life.hover(pick)                      the cursor's pick (birds take off near it; chimes ring)
//     life.update(dt, { motion, calm, season, focus }) -> 0 | 1
//     life.warmup() -> [Object3D]           hidden meshes for the boot shader warm-up
//     life.setQuality('high' | 'medium' | 'low')   mobile wave: phones keep fewer birds (wave 4: all in one draw) and
//                                           butterflies, and drift fewer ambient motes, sparkles and glints
//     life.stats() -> { butterflies, birds, balloon, rainbow }
//   balloonAt(now) -> { x, z, y, on } | null      the balloon's flight at server time (pure, tested)
//   perches(state) -> [{ x, z, y }]                fence posts birds may sit on (pure, tested)
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { boundaryEdges, landTiles } from './ground.js';
import { models } from './models.js';
import * as content from '../../../shared/content/index.js';

// the rules drop the balloon's loot crates on this schedule (content CRATES, wave 4b: a pass every everyMs, flightMs long;
// the drop dropAtMs into it): the same numbers here keep the parachute under the balloon if content ever changes them
const BALLOON_EVERY = content.CRATES?.everyMs ?? 10 * 60_000;
const BALLOON_FLIGHT = content.CRATES?.flightMs ?? 110_000;

const h1 = (n) => { let x = Math.imul(n | 0, 2654435761) ^ 0x5bd1e995; x ^= x >>> 15; x = Math.imul(x, 2246822507); x ^= x >>> 13; return (x >>> 0) / 4294967296; };

/** The balloon's position at server time `now` (metres): one crossing every 10 minutes, 110 s long. Pure. */
export function balloonAt(now) {
  const k = Math.floor(now / BALLOON_EVERY);
  const into = now - k * BALLOON_EVERY;
  if (into > BALLOON_FLIGHT) return null;
  const t = into / BALLOON_FLIGHT;
  const a = h1(k) * Math.PI * 2;                       // a different heading every flight
  const cx = 64; const cz = 64; const R = 150;
  const x0 = cx + Math.cos(a) * R; const z0 = cz + Math.sin(a) * R;
  const x1 = cx - Math.cos(a + 0.5) * R; const z1 = cz - Math.sin(a + 0.5) * R;
  return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, y: 30 + 6 * Math.sin(t * Math.PI), on: true, t };
}

/** Fence posts birds may perch on: the owned land's boundary fence and the farm's own picket fences. Pure. */
export function perches(state, max = 7) {
  if (!state) return [];
  const out = [];
  const land = landTiles(state.farm.expansions);
  const seen = new Set();
  for (const [x0, z0, x1, z1] of boundaryEdges(land)) {
    for (const [px, pz] of [[x0, z0], [x1, z1]]) {
      const k = `${px},${pz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: px * TILE_M, z: pz * TILE_M, y: 1.12, h: h1(px * 977 + pz) });
    }
  }
  for (const o of Object.values(state.farm.objects)) {
    const d = defOf(o.def);
    if (!d || !d.effect || !d.effect.autojoin || !Number.isFinite(o.x)) continue;
    out.push({ x: (o.x + 0.5) * TILE_M, z: (o.z + 0.5) * TILE_M, y: 0.98, h: h1(o.x * 131 + o.z * 7) });
  }
  out.sort((a, b) => a.h - b.h);
  return out.slice(0, max);
}

function wingTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(20, 26, 15, 18, -0.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(44, 26, 15, 18, 0.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(23, 46, 10, 11, 0.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(41, 46, 10, 11, -0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3A2A1A';
  g.fillRect(30, 18, 4, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The little perching bird (a canvas sprite; the bird baths' visitors reuse it, wave 4). */
export function birdTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#7A5A3A';
  g.beginPath(); g.ellipse(32, 38, 15, 12, 0, 0, Math.PI * 2); g.fill();            // body
  g.beginPath(); g.arc(44, 28, 9, 0, Math.PI * 2); g.fill();                         // head
  g.fillStyle = '#E8C29A';
  g.beginPath(); g.ellipse(34, 43, 9, 6, 0, 0, Math.PI * 2); g.fill();               // breast
  g.fillStyle = '#F5A623';
  g.beginPath(); g.moveTo(52, 27); g.lineTo(60, 29); g.lineTo(52, 31); g.fill();     // beak
  g.fillStyle = '#5A3A22';
  g.beginPath(); g.moveTo(18, 36); g.lineTo(4, 30); g.lineTo(8, 42); g.fill();       // tail
  g.fillStyle = '#1A1008';
  g.beginPath(); g.arc(46, 26, 2, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createAmbientLife(layers, { now: nowFn = () => Date.now(), overlay = null } = {}) {
  let now = nowFn;
  let state = null;
  let fx = null;
  let clock = 0;
  let night = 0;
  let rain = 0;
  let gold = 0;
  let wasRaining = false;
  let rainbowUntil = -1;
  let hoverPick = null;
  const group = new THREE.Group();
  group.name = 'ambient-life';
  (layers.fx || layers.objects).add(group);

  // --- butterflies: instanced camera-facing quads with a wing-flap in the vertex shader
  const BF = 16;
  // mobile wave (render lane): the phone tiers keep the charm at a lower cost
  const LIFE_Q = { high: { birds: 6, bf: BF, k: 1 }, medium: { birds: 4, bf: 10, k: 0.6 }, low: { birds: 3, bf: 6, k: 0.35 } };
  let lifeQ = LIFE_Q.high;
  let beauty = { score: 0, stars: 0 };
  let sets = [];
  let sparkAt = 0;
  let pretty = [];                      // decor with beauty >= 12 (where the sparkles drift from)
  const bfGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  bfGeo.index = quad.index;
  bfGeo.setAttribute('position', quad.getAttribute('position'));
  bfGeo.setAttribute('uv', quad.getAttribute('uv'));
  const bfA = new THREE.InstancedBufferAttribute(new Float32Array(BF * 4), 4);     // home xyz, seed
  const bfC = new THREE.InstancedBufferAttribute(new Float32Array(BF * 3), 3);
  bfGeo.setAttribute('aHome', bfA);
  bfGeo.setAttribute('aCol', bfC);
  bfGeo.instanceCount = 0;
  const uTime = { value: 0 };
  const bfMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime, uMap: { value: wingTexture() } },
    vertexShader: /* glsl */`
      attribute vec4 aHome; attribute vec3 aCol;
      uniform float uTime;
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        float t = uTime * 0.45 + aHome.w * 17.0;
        vec3 p = aHome.xyz + vec3( sin( t ) * 1.6 + sin( t * 2.3 ) * 0.5, 0.45 + 0.35 * sin( t * 1.7 ), cos( t * 0.9 ) * 1.4 );
        float flap = 0.25 + 0.75 * abs( sin( uTime * 14.0 + aHome.w * 40.0 ) );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        mv.xy += vec2( position.x * flap, position.y ) * 0.32;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vCol = aCol;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying vec2 vUv; varying vec3 vCol;
      void main() { vec4 t = texture2D( uMap, vUv ); if ( t.a < 0.4 ) discard; gl_FragColor = vec4( t.rgb * vCol, 1.0 );
        #include <colorspace_fragment>
      }`,
  });
  const bfMesh = new THREE.Mesh(bfGeo, bfMat);
  bfMesh.frustumCulled = false;
  bfMesh.renderOrder = 9;
  bfMesh.name = 'butterflies';
  group.add(bfMesh);
  const BF_COLORS = ['#FFC83D', '#FFFFFF', '#FF9FB0', '#9CC9FF', '#FFE27A', '#F7A35C'];

  // --- birds on fence posts that fly off when a cursor comes within 2 m. Wave 4 (render lane, "no heavier"): one
  //     instanced draw for all of them (each was a Sprite: a draw call a bird); `sprite` is a light proxy flushed into it
  const birdTex = birdTexture();
  const birds = [];
  const FB_MAX = 8;
  const fbGeo = new THREE.InstancedBufferGeometry();
  fbGeo.index = quad.index;
  fbGeo.setAttribute('position', quad.getAttribute('position'));
  fbGeo.setAttribute('uv', quad.getAttribute('uv'));
  const fbPos = new THREE.InstancedBufferAttribute(new Float32Array(FB_MAX * 4), 4);
  fbGeo.setAttribute('aPos', fbPos);
  fbGeo.instanceCount = 0;
  const fbMesh = new THREE.Mesh(fbGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uMap: { value: birdTex } },
    vertexShader: /* glsl */`
      attribute vec4 aPos; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4( aPos.xyz, 1.0 );
        mv.xy += ( position.xy + vec2( 0.0, 0.35 ) ) * 0.42;          // the old sprite's size and its centre (0.5, 0.15)
        gl_Position = aPos.w > 0.5 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; varying vec2 vUv;
      void main() { vec4 t = texture2D( uMap, vUv ); if ( t.a < 0.5 ) discard; gl_FragColor = vec4( t.rgb, 1.0 );
        #include <colorspace_fragment>
      }`,
  }));
  fbMesh.frustumCulled = false;
  fbMesh.renderOrder = 9;
  fbMesh.name = 'fence-birds';
  fbMesh.visible = false;
  group.add(fbMesh);
  const fbKey = new Float32Array(FB_MAX * 4);
  const frustum = new THREE.Frustum();
  const fbM = new THREE.Matrix4();
  const fbS = new THREE.Sphere(new THREE.Vector3(), 0.5);
  function flushBirds(camera = null) {
    let any = false; let dirty = false;
    // only the birds on screen draw (none on screen: no draw call)
    if (camera) frustum.setFromProjectionMatrix(fbM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    birds.forEach((b, i) => {
      const s0 = b.sprite;
      const v = s0.visible && (!camera || frustum.intersectsSphere(fbS.set(s0.position, 0.5))) ? 1 : 0;
      if (v) any = true;
      const o = i * 4;
      if (fbKey[o] !== s0.position.x || fbKey[o + 1] !== s0.position.y || fbKey[o + 2] !== s0.position.z || fbKey[o + 3] !== v) {
        fbKey[o] = s0.position.x; fbKey[o + 1] = s0.position.y; fbKey[o + 2] = s0.position.z; fbKey[o + 3] = v;
        fbPos.setXYZW(i, s0.position.x, s0.position.y, s0.position.z, v);
        dirty = true;
      }
    });
    fbGeo.instanceCount = birds.length;
    fbMesh.visible = any;
    if (dirty) fbPos.needsUpdate = true;
  }
  function rebuildLife() {
    birds.length = 0;
    fbKey.fill(NaN);
    if (!state) { bfGeo.instanceCount = 0; flushBirds(); return; }
    for (const p of perches(state, Math.min(FB_MAX, lifeQ.birds))) {
      const sprite = { position: new THREE.Vector3(p.x, p.y, p.z), visible: false };
      birds.push({ sprite, home: p, state: 'perched', t0: 0, back: 0, dir: p.h * Math.PI * 2 });
    }
    // butterflies: over flower decor first, else over the lawn near the farmhouse; their number grows with Farm
    // Beauty (4 + 2 per star) and every complete Cottage Garden keeps a little cloud of its own
    const homes = [];
    pretty = [];
    for (const o of Object.values(state.farm.objects)) {
      const d = defOf(o.def);
      if (!d || !Number.isFinite(o.x)) continue;
      if (d.kind === 'decor' && /flower|tulip|rose|planter|blossom|arbor|garden/.test(d.id)) homes.push(o);
      if (d.kind === 'decor' && (d.beauty10 || 0) >= 120) pretty.push(o);
    }
    if (!homes.length) for (const o of Object.values(state.farm.objects)) if (o.def === 'farmhouse' || o.def === 'market_stand') homes.push(o);
    const setHomes = sets.filter((st) => st.cosmetic === 'butterflies').map((st) => ({ x: st.x - 1, z: st.z - 1, set: true }));
    const want = Math.min(lifeQ.bf, 4 + 2 * (beauty.stars || 0) + setHomes.length * 3);
    let n = 0;
    for (let i = 0; i < want && (homes.length || setHomes.length); i++) {
      const o = i < setHomes.length * 3 ? setHomes[i % setHomes.length] : homes[i % Math.max(1, homes.length)];
      if (!o) break;
      const s = h1(i * 31 + (o.x | 0) * 7 + (o.z | 0));
      bfA.setXYZW(n, (o.x + 1 + (s - 0.5) * 2) * TILE_M, 0.6, (o.z + 1 + (h1(i + 5) - 0.5) * 2) * TILE_M, s);
      const c = new THREE.Color(BF_COLORS[i % BF_COLORS.length]);
      bfC.setXYZ(n, c.r, c.g, c.b);
      n++;
    }
    bfA.needsUpdate = true; bfC.needsUpdate = true;
    bfGeo.instanceCount = n;
  }

  // --- the hot-air balloon: the decor model, small and high, on its shared schedule
  let balloon = null;
  function ensureBalloon() {
    // the flying balloon alone (render-life's `prop:balloon`, basket floor at y 0); the decor is now its mooring
    const BK = models.has('prop:balloon') ? 'prop:balloon' : 'decor:hot_air_balloon';
    if (balloon || !models.has(BK)) return;
    if (!models.isReady(BK)) { models.ready(BK).catch(() => {}); return; }
    balloon = new THREE.Mesh(models.geometryFor(BK), models.material('standard'));
    balloon.scale.setScalar(1.6);
    balloon.visible = false;
    balloon.name = 'balloon';
    group.add(balloon);
  }

  // --- the rainbow: an arc of soft bands low in the sky for a minute after the rain (§3.10)
  const rainbow = (() => {
    const geo = new THREE.RingGeometry(150, 175, 64, 1, 0, Math.PI);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: /* glsl */`
        uniform float uA; varying vec2 vP;
        void main() {
          float r = ( length( vP ) - 150.0 ) / 25.0;
          vec3 c = clamp( vec3( abs( r * 6.0 - 3.0 ) - 1.0, 2.0 - abs( r * 6.0 - 2.0 ), 2.0 - abs( r * 6.0 - 4.0 ) ), 0.0, 1.0 );
          float edge = smoothstep( 0.0, 0.15, r ) * smoothstep( 1.0, 0.85, r ) * smoothstep( 0.0, 40.0, vP.y );
          gl_FragColor = vec4( c * uA * edge * 0.55, 1.0 );
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(64, -20, -120);
    m.visible = false;
    m.renderOrder = 3;
    m.name = 'rainbow';
    (layers.sky || group).add(m);
    return m;
  })();

  // --- Golden Hour vignette (4 %), a DOM layer over the canvas
  let vignette = null;
  if (overlay && typeof document !== 'undefined') {
    vignette = document.createElement('div');
    vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 1.2s;'
      + 'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(110,55,0,0.22) 100%)';
    overlay.appendChild(vignette);
  }

  let moteAcc = 0;
  let heartAcc = 0;
  let farmersFn = null;
  let glintAcc = 0;
  const v3 = new THREE.Vector3();

  return {
    setNow(fn) { now = fn; },
    setFx(f) { fx = f; },
    setState(s) { state = s; rebuildLife(); },
    /** Where the farmers stand (metres): Golden Hour's hearts gather round them. */
    setFarmers(fn) { farmersFn = typeof fn === 'function' ? fn : null; },
    setBeauty(b, complete = []) {
      const key = `${b?.stars || 0}|${complete.map((st) => st.id).join(',')}`;
      beauty = b || { score: 0, stars: 0 };
      sets = complete;
      if (key !== this._beautyKey) { this._beautyKey = key; rebuildLife(); }
    },
    sync(ids, topics, s) {
      state = s;
      if (topics.has('*') || topics.has('expansions')) { rebuildLife(); return; }
      for (const id of ids || []) {
        const d = defOf(s.farm.objects[id]?.def);
        // decor, and a landmark that moved (the butterflies' fallback home is the farmhouse or the Market Stand)
        if (!d || d.kind === 'decor' || d.kind === 'landmark') { rebuildLife(); return; }
      }
    },
    setSky(sky, wx, g) {
      night = sky.night;
      gold = g || 0;
      rain = wx ? wx.rain : 0;
      const raining = wx && wx.kind === 'rain';
      // wave 4 (owner wish 12): the rainbow after a shower is render/index.js's now (shared by both screens, standing in
      // the view: this one, 170 m out low in the sky, sat above the top of the farm camera's view); this one stays off
      void wasRaining;
      wasRaining = Boolean(raining);
      if (vignette) vignette.style.opacity = String(Math.min(1, gold) * 0.85);
    },
    hover(pick) {
      hoverPick = pick;
      // wind chimes ring on hover (the decor text promises it): a swing, notes, and a page event for the sound
      if (pick && pick.kind === 'object' && state && Object.hasOwn(state.farm.objects, pick.id)) {
        const o = state.farm.objects[pick.id];
        if (/chime/.test(o.def) && fx) {
          const last = this._chimeAt || -10;
          if (clock - last > 1.2) {
            this._chimeAt = clock;
            fx.burst('note', v3.set((o.x + 0.5) * TILE_M, 1.6, (o.z + 0.5) * TILE_M), { n: 3, colors: ['#FFE27A', '#BFE6FF', '#FFFFFF'], speed: 0.5, up: 1.2, size: 0.3, grav: -0.05, life: 1.2, ambient: true });
            try { dispatchEvent(new CustomEvent('hh:chime', { detail: { id: pick.id } })); } catch { /* no window */ }
          }
        }
      }
    },
    update(dt, { motion = 'full', season = 'summer', focus = null, camera = null } = {}) {
      clock += dt;
      uTime.value = clock;
      const still = motion === 'still';
      const day = night < 0.5 && rain < 0.3;
      let want = 0;
      // butterflies: by day, not in the rain or the winter
      bfMesh.visible = !still && day && season !== 'winter' && bfGeo.instanceCount > 0;
      if (bfMesh.visible) want = 1;
      // birds: perched (hop now and then), fly off from a cursor within 2 m, back after 8-15 s
      const cx = hoverPick ? hoverPick.px * TILE_M : null; const cz = hoverPick ? hoverPick.pz * TILE_M : null;
      for (const b of birds) {
        const near = cx !== null && Math.hypot(cx - b.home.x, cz - b.home.z) < 2;
        if (b.state === 'perched' && near && !still) { b.state = 'flying'; b.t0 = clock; b.back = clock + 8 + b.home.h * 7; }
        if (b.state === 'flying' && clock > b.back && !near) { b.state = 'landing'; b.t0 = clock; }
        const s = b.sprite;
        s.visible = night < 0.5 && !still;
        if (b.state === 'perched') {
          const hop = Math.max(0, Math.sin(clock * 1.3 + b.home.h * 20)) > 0.985 ? 0.06 : 0;
          s.position.set(b.home.x, b.home.y + hop, b.home.z);
        } else {
          const k = Math.min(1, (clock - b.t0) / 1.6);
          const away = b.state === 'flying' ? k : 1 - k;
          const e = away * away;
          s.position.set(b.home.x + Math.cos(b.dir) * 18 * e, b.home.y + 9 * e + Math.sin(clock * 20) * 0.05 * away, b.home.z + Math.sin(b.dir) * 18 * e);
          if (b.state === 'landing' && k >= 1) b.state = 'perched';
          if (b.state === 'flying' && k >= 1) s.visible = false;
          want = 1;
        }
        if (s.visible) want = 1;
      }
      flushBirds(camera);
      // the balloon
      ensureBalloon();
      const bl = balloon ? balloonAt(now()) : null;
      if (balloon) {
        balloon.visible = Boolean(bl) && !still && night < 0.6;
        if (balloon.visible) { balloon.position.set(bl.x, bl.y, bl.z); balloon.rotation.y = clock * 0.05; want = 1; }
      }
      // the rainbow after the rain
      const rb = rainbowUntil - clock;
      rainbow.visible = rb > 0 && night < 0.5;
      if (rainbow.visible) {
        rainbow.material.uniforms.uA.value = Math.min(1, (60 - rb) / 4, rb / 6);
        if (focus) { rainbow.position.set(focus.x, -25, focus.z - 170); rainbow.lookAt(focus.x, 10, focus.z); }
        want = 1;
      }
      if (!fx || still) return want;
      // Golden Hour (visual-after D2): the moment belongs to the two of them: a few heart and leaf motes drift up around
      // each farmer (6-10 in all), with only a light dusting of warm motes over the rest of the view
      if (gold > 0.05 && focus) {
        const farmers = farmersFn ? farmersFn() : [];
        heartAcc += dt * 1.1 * gold * Math.max(1, farmers.length) * lifeQ.k;
        for (; heartAcc >= 1 && farmers.length; heartAcc -= 1) {
          const f = farmers[Math.floor(Math.random() * farmers.length)];
          const a = Math.random() * Math.PI * 2; const r = 0.5 + Math.random() * 1.1;
          v3.set(f.x + Math.cos(a) * r, 0.5 + Math.random() * 1.2, f.z + Math.sin(a) * r);
          const heart = Math.random() < 0.6;
          fx.burst(heart ? 'heart' : 'leaf', v3, { n: 1, colors: heart ? ['#FFB3C1', '#FF9FB0', '#FFD166'] : ['#FFD166', '#F2B55E', '#E9B83F'], speed: 0.12,
            up: 0.35, size: heart ? 0.2 : 0.18, sizeEnd: 0.08, life: 4, grav: -0.01, spread: 0.2, spin: 0.8, y: 0, ambient: true });
        }
        if (!farmers.length) heartAcc = 0;
        moteAcc += dt * 1.2 * gold * lifeQ.k;
        for (; moteAcc >= 1; moteAcc -= 1) {
          v3.set(focus.x + (Math.random() - 0.5) * 30, 0.5 + Math.random() * 2.5, focus.z + (Math.random() - 0.5) * 30);
          fx.burst('glow', v3, { n: 1, color: '#FFE2A0', speed: 0.15, up: 0.12, size: 0.14, sizeEnd: 0.08, life: 4.5, grav: -0.002, spread: 0.5, y: 0, alpha: 0.6, ambient: true });
        }
        want = 1;
      }
      // Farm Beauty: soft sparkles drift off the prettiest decor by day, more with every star (GDD §5.9)
      if (beauty.stars > 0 && pretty.length && day) {
        sparkAt -= dt * (0.25 + 0.35 * beauty.stars) * lifeQ.k;
        for (; sparkAt <= 0; sparkAt += 1) {
          const o = pretty[Math.floor(Math.random() * pretty.length)];
          v3.set((o.x + 0.5 + (Math.random() - 0.5) * 1.6) * TILE_M, 0.6 + Math.random() * 1.4, (o.z + 0.5 + (Math.random() - 0.5) * 1.6) * TILE_M);
          fx.burst('sparkle', v3, { n: 1, colors: ['#FFF3C4', '#FFE27A', '#FFFFFF'], speed: 0.05, up: 0.25, size: 0.2, sizeEnd: 0.04, life: 1.6, grav: -0.02, spread: 0, spin: 1, y: 0, additive: true, ambient: true });
        }
        want = 1;
      }
      // winter: glints on the snow, about six a second (visual-24)
      if (season === 'winter' && rain < 0.1 && night < 0.6 && focus) {
        glintAcc += dt * 6 * lifeQ.k;
        for (; glintAcc >= 1; glintAcc -= 1) {
          v3.set(focus.x + (Math.random() - 0.5) * 40, 0.05, focus.z + (Math.random() - 0.5) * 40);
          fx.burst('sparkle', v3, { n: 1, color: '#FFFFFF', speed: 0, up: 0, size: 0.22, sizeEnd: 0.05, life: 0.7, grav: 0, spread: 0, spin: 1, y: 0.05, ambient: true });
        }
        want = 1;
      }
      return want;
    },
    setQuality(q) {
      const next = LIFE_Q[q] || LIFE_Q.high;
      if (next === lifeQ) return;
      lifeQ = next;
      rebuildLife();
    },
    warmup() {
      const was = fbMesh.visible;
      fbMesh.visible = true;
      return [{ removeFromParent() { fbMesh.visible = was; } }];
    },
    stats() {
      return { butterflies: bfMesh.visible ? bfGeo.instanceCount : 0, birds: birds.filter((b) => b.sprite.visible).length,
        balloon: Boolean(balloon && balloon.visible), rainbow: rainbow.visible };
    },
  };
}
