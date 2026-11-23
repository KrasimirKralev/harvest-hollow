// Placement ghost (tech §10.7, visual-ux-juice §3.8): the real model, translucent and tinted, over a tiled
// footprint on the ground; green when valid, red PLUS a hatched footprint and a ✕ badge when not (never
// colour-only, WCAG 1.4.1). Also used for the partner's ghost in their colour (avatars-view.js).
// Owned by the render-world lane.
//
//   createGhost(layer, { valid = '#A8D1B2', invalid = '#E5534B', smooth = false }) -> ghost
//     ghost.show(defId, rot = 0, { size?, key? }?) / ghost.hide()   wave 4b: a moved grown home shows its own size ([w, d]
//                                          at rot 0) and model key (render/index.js passes them for the hidden original)
//     ghost.update(tile {x, z}, valid, reason, colorOverride?)   tile = min corner; reason is shown by the UI
//     ghost.tick(dt) -> boolean moving     glide toward the tile at 20/s (smooth ghosts only)
//     ghost.visible / ghost.def / ghost.tile / ghost.centre ({x, z} tiles of the footprint centre, or null)
//     ghost.warmup(on)                     boot shader warm-up: draw (hidden from nothing) once
// The model reads as ONE clean translucent shape (visual-10): a flat tint without vertex colours at 0.4, drawn
// over a ghost-only depth pre-pass (so no interior surface shows through), inside a ~2 px white OUTER silhouette (an
// inverted hull pushed out along the normals and back in depth, so the internal edges never draw: visual-after E8).
import * as THREE from 'three';
import { defOf } from '../../../shared/content/index.js';
import { TILE_M } from '../../../shared/content/config.js';
import { footprint } from '../../../shared/rules/grid.js';
import { models } from './models.js';

/** The model key a ghost shows for a def (a tree goes in as a sapling). */
export function ghostKey(defId) {
  const def = defOf(defId);
  if (!def) return null;
  if (def.kind === 'plot') return 'plot';
  if (def.kind === 'tree') return models.treeKey(defId, 'sapling');
  return models.keyOf(defId);
}

let crossTex = null;
function crossTexture() {
  if (crossTex) return crossTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#E5534B';
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 5;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill(); g.stroke();
  g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(21, 21); g.lineTo(43, 43); g.moveTo(43, 21); g.lineTo(21, 43); g.stroke();
  crossTex = new THREE.CanvasTexture(c);
  crossTex.colorSpace = THREE.SRGBColorSpace;
  return crossTex;
}

export function createGhost(layer, { valid = '#A8D1B2', invalid = '#E5534B', smooth = false } = {}) {
  const root = new THREE.Group();
  root.name = 'ghost';
  root.visible = false;
  layer.add(root);
  const mat = models.createMaterial({ vertexColors: false, transparent: true, opacity: 0.4, depthWrite: false });
  mat.color.set(valid);
  const empty = new THREE.BufferGeometry();
  const model = new THREE.Mesh(empty, mat);
  model.renderOrder = 7;
  // the depth pre-pass: front-most surface only (opaque pass, writes depth, no colour)
  const prepass = new THREE.Mesh(empty, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }));
  prepass.renderOrder = 5;
  // the silhouette (visual-after E8: no wireframe): a copy whose vertices are pushed out ~3 px on screen, away from
  // the model's centre (the same push for every face at a corner: no cracks), and 2.2 m back in depth, so it loses
  // to the ghost's own front surfaces everywhere inside the shape (the edges between a roof and its walls, a chimney
  // and its roof stay clean) and only the outer rim shows
  const hull = new THREE.Mesh(empty, new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#FFFFFF') }, uPx: { value: 0.0026 }, uPush: { value: 2.2 }, uCentre: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      uniform float uPx; uniform float uPush; uniform vec3 uCentre;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vec4 c = modelViewMatrix * vec4( uCentre, 1.0 );
        vec2 d = mv.xy - c.xy;
        float l = length( d );
        if ( l > 1e-4 ) mv.xy += ( d / l ) * ( -mv.z ) * uPx;
        // pushed back in DEPTH only: moving the vertex itself back would also pull it toward the vanishing point
        vec4 clip = projectionMatrix * mv;
        vec4 back = projectionMatrix * vec4( mv.xy, mv.z - uPush, 1.0 );
        clip.z = back.z / back.w * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4( uColor, 0.9 );
        #include <colorspace_fragment>
      }`,
  }));
  hull.renderOrder = 6;
  const shape = new THREE.Group();
  shape.add(prepass, hull, model);
  root.add(shape);
  // Footprint: one quad, tiles drawn procedurally (rounded cells, hatching when invalid).
  const fpU = { uSize: { value: new THREE.Vector2(1, 1) }, uColor: { value: new THREE.Color(valid) }, uBad: { value: 0 } };
  const fp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: fpU,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: /* glsl */`
      uniform vec2 uSize; uniform vec3 uColor; uniform float uBad; varying vec2 vUv;
      void main() {
        vec2 t = vUv * uSize;
        vec2 f = fract( t ); vec2 q = abs( f - 0.5 );
        float cell = 1.0 - smoothstep( 0.42, 0.46, max( q.x, q.y ) );
        float edge = smoothstep( 0.34, 0.44, max( q.x, q.y ) ) * cell;
        float hatch = step( 0.5, fract( ( t.x + t.y ) * 2.5 ) ) * uBad;
        float a = cell * ( 0.22 + 0.45 * edge + 0.25 * hatch );
        gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), edge * 0.35 ), a );
        #include <colorspace_fragment>
      }`,
  }));
  fp.rotation.x = -Math.PI / 2;
  fp.position.y = 0.04;
  fp.renderOrder = 5;
  root.add(fp);
  const cross = new THREE.Sprite(new THREE.SpriteMaterial({ map: crossTexture(), depthTest: false, transparent: true }));
  cross.scale.set(1.1, 1.1, 1);
  cross.renderOrder = 21;
  cross.visible = false;
  root.add(cross);

  let def = null;
  let defId = null;
  let rot = 0;
  let key = null;
  let size = null;                     // [w, d] at rot 0 when not the def's (a grown home being moved: wave 4b)
  let height = 1;
  let tile = null;
  const goal = new THREE.Vector3();
  let snap = true;

  function setGeometry() {
    const g = (key && models.geometryFor(key)) || (key ? models.placeholder(key) : null);
    if (g) { model.geometry = g; prepass.geometry = g; hull.geometry = g; }
    height = key ? models.boundsOf(key).max.y : 1;
    if (key) models.boundsOf(key).getCenter(hull.material.uniforms.uCentre.value);
    if (key && !models.isReady(key) && models.has(key)) {
      const want = key;
      models.ready(key).then(() => { if (key === want) setGeometry(); }, () => {});
    }
  }

  return {
    show(id, r = 0, opts = null) {
      const d = defOf(id) || null;
      if (id !== defId) { snap = true; }
      def = d; defId = id; rot = r || 0;
      size = opts && Array.isArray(opts.size) ? opts.size : null;
      key = d ? (opts && opts.key && models.has(opts.key) ? opts.key : ghostKey(id)) : null;
      setGeometry();
      shape.rotation.y = rot * (Math.PI / 2);
      root.visible = Boolean(def) && Boolean(tile);
    },
    hide() { root.visible = false; def = null; defId = null; tile = null; size = null; snap = true; },
    update(t, ok, _reason, colorOverride) {
      if (!def || !t) { root.visible = false; tile = null; return; }
      const [w, d] = size ? (rot % 2 ? [size[1], size[0]] : size) : footprint(def, rot);
      tile = { x: t.x, z: t.z };
      goal.set((t.x + w / 2) * TILE_M, 0, (t.z + d / 2) * TILE_M);
      if (!smooth || snap || !root.visible) { root.position.copy(goal); snap = false; }
      root.visible = true;
      shape.rotation.y = rot * (Math.PI / 2);
      fp.scale.set(w * TILE_M, d * TILE_M, 1);
      fpU.uSize.value.set(w, d);
      const c = colorOverride || (ok ? valid : invalid);
      mat.color.set(c);
      fpU.uColor.value.set(c);
      fpU.uBad.value = ok ? 0 : 1;
      cross.visible = !ok && !colorOverride;
      cross.position.set(0, height + 0.9, 0);
    },
    tick(dt) {
      if (!root.visible) return false;
      const k = 1 - Math.exp(-20 * dt);
      const dx = goal.x - root.position.x;
      const dz = goal.z - root.position.z;
      if (Math.abs(dx) + Math.abs(dz) < 0.002) { root.position.copy(goal); return false; }
      root.position.x += dx * k;
      root.position.z += dz * k;
      return true;
    },
    get visible() { return root.visible; },
    /** The silhouette mesh (look-dev / tests). */
    get outline() { return hull; },
    get def() { return defId; },
    get tile() { return tile; },
    get centre() { return root.visible && tile ? { x: goal.x / TILE_M, z: goal.z / TILE_M } : null; },
    warmup(on) {
      if (on) {
        if (!key) { model.geometry = prepass.geometry = hull.geometry = models.placeholder('plot'); }
        root.visible = true;
        root.position.set(0, -50, 0);              // under the world: compiled, never seen
      } else if (!def) { root.visible = false; root.position.set(0, 0, 0); }
    },
  };
}
