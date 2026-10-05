// World badges (tech §10.2 `badges` layer; visual-ux-juice §3.7-3.8, §4.13): product-ready bubbles over
// production buildings (the product's icon in a white bubble, bobbing at 120 BPM), tray-full in the
// attention colour, and any other marker keyed by object id. All badges are ONE instanced draw: camera-facing
// quads reading a canvas atlas built at runtime from render-life's icons (icons.js), so the HUD, panels and
// the world share one picture of every item. Owned by the render-world lane.
//
//   createBadges(layer) -> badges
//     badges.set(id, { icon, style = 'ready' | 'full' | 'need' | 'tend', count?, pos: Vector3 (metres), scale? } | null)
//        icon '_water' draws the teardrop "needs water" pin (style 'need': nobody watered it; 'tend': the partner
//        watered it and my tend still helps); icon '_pin:#RRGGBB' a push-pin in the pinner's colour (CL-05:
//        pinned decor); pins sit still, bubbles bob
//     badges.update(dt) -> 0|1   (1 while any badge bobs)
//     badges.setMotion(mode) / badges.count / badges.slotKey(icon, style, count)   (pure part, tested)
//   badgeSize(viewDist, scale = 1) -> metres   screen-stable size (pure, tested): ~58 px at every zoom
//     (RD-09: 0.035 of the view distance, clamped to 0.43..2.5 m; ivory #F3E6C8 bubbles)
import * as THREE from 'three';
import { iconUrl } from './icons.js';
import { WORLD } from './world-uniforms.js';

const SLOT = 128;
const GRID = 8;                                  // 8 x 8 slots of 128 px = a 1024 px atlas
const STYLE = {
  ready: { fill: '#F3E6C8', ring: '#FFF8EA', edge: 'rgba(90,60,30,0.35)' },
  full: { fill: '#FFF1C4', ring: '#FFC83D', edge: 'rgba(150,100,10,0.55)' },
  need: { fill: '#5BC0F0', ring: '#BFEAFF', edge: '#1F6FA8' },
  tend: { fill: '#E7B6F2', ring: '#FBE8FF', edge: '#8E4FA6' },
  pin: { fill: '#FFFFFF', ring: '#FFFFFF', edge: '#5A3418' },
};
// RD-09 (QA wave 2: balloons outshouted the farm): ~58 px on screen (was ~75, 40 % less area), still >= 44 px
export const BADGE = Object.freeze({ k: 0.035, min: 0.43, max: 2.5 });

/** Atlas slot key for an icon/style/count combination. */
export function slotKey(icon, style = 'ready', count = 0) {
  return `${icon}|${STYLE[style] ? style : 'ready'}|${count > 1 ? Math.min(count, 99) : 0}`;
}

/** World size (metres) of a badge seen from `viewDist` metres: constant on screen (visual-06). */
export function badgeSize(viewDist, scale = 1) {
  return Math.min(BADGE.max, Math.max(BADGE.min, viewDist * BADGE.k)) * scale;
}

export function createBadges(layer) {
  const cnv = document.createElement('canvas');
  cnv.width = SLOT * GRID; cnv.height = SLOT * GRID;
  const g = cnv.getContext('2d');
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const slots = new Map();                       // slotKey -> index
  const images = new Map();                      // icon id -> Image
  let nextSlot = 0;

  /** The teardrop pin (FV2's blue water pins): a drop pointing down at the plot, a glossy highlight. */
  function drawDrop(st, style) {
    g.fillStyle = 'rgba(30,40,60,0.2)';
    g.beginPath(); g.ellipse(64, 118, 16, 5, 0, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(64, 116);
    g.bezierCurveTo(30, 78, 26, 58, 34, 40);
    g.arc(64, 50, 32, Math.PI * 1.08, Math.PI * 1.92);
    g.bezierCurveTo(102, 58, 98, 78, 64, 116);
    g.closePath();
    g.fillStyle = st.fill; g.fill();
    g.lineWidth = 6; g.strokeStyle = st.edge; g.stroke();
    g.fillStyle = st.ring;
    g.beginPath(); g.ellipse(52, 44, 9, 14, -0.5, 0, Math.PI * 2); g.fill();
    if (style === 'tend') {
      // the partner tend: a small white heart in the drop (it adds -5 % and a Heart)
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.moveTo(66, 86); g.bezierCurveTo(46, 72, 52, 56, 66, 66); g.bezierCurveTo(80, 56, 86, 72, 66, 86); g.fill();
    }
  }

  /** A push-pin (pinned decor): a round head in the pinner's colour on a short needle. */
  function drawPushPin(hex) {
    g.fillStyle = 'rgba(30,20,10,0.22)';
    g.beginPath(); g.ellipse(64, 118, 12, 4, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8C8880'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(64, 70); g.lineTo(64, 114); g.stroke();
    g.fillStyle = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#FFC83D';
    g.strokeStyle = '#5A3418'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 48, 30, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.ellipse(54, 38, 9, 6, -0.6, 0, Math.PI * 2); g.fill();
  }

  function drawBubble(i, key) {
    const [icon, style, countS] = key.split('|');
    const st = STYLE[style] || STYLE.ready;
    const x0 = (i % GRID) * SLOT; const y0 = Math.floor(i / GRID) * SLOT;
    g.clearRect(x0, y0, SLOT, SLOT);
    g.save();
    g.translate(x0, y0);
    if (icon === '_water') { drawDrop(st, style); g.restore(); tex.needsUpdate = true; return; }
    if (icon.startsWith('_pin:')) { drawPushPin(icon.slice(5)); g.restore(); tex.needsUpdate = true; return; }
    // soft drop shadow, bubble with a tail pointing down at the building
    g.fillStyle = 'rgba(40,30,20,0.18)';
    g.beginPath(); g.ellipse(64, 60, 50, 48, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = st.fill;
    g.strokeStyle = st.edge;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(64, 54, 46, Math.PI * 0.62, Math.PI * 2.38);
    g.lineTo(64, 120);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = st.ring;
    g.lineWidth = 5;
    g.beginPath(); g.arc(64, 54, 40, 0, Math.PI * 2); g.stroke();
    const img = images.get(icon);
    if (img && img.complete && img.naturalWidth) g.drawImage(img, 64 - 34, 54 - 34, 68, 68);
    if (Number(countS) > 1) {
      g.fillStyle = '#E8463A';
      g.beginPath(); g.arc(102, 22, 19, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFFFFF';
      g.font = '700 24px Fredoka, "Baloo 2", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${countS}`, 102, 23);
    }
    g.restore();
    tex.needsUpdate = true;
  }

  function slotFor(icon, style, count) {
    const key = slotKey(icon, style, count);
    let i = slots.get(key);
    if (i !== undefined) return i;
    i = nextSlot % (GRID * GRID);
    nextSlot++;
    // a recycled slot loses its previous owner's picture: drop the stale mapping
    for (const [k, v] of slots) if (v === i) slots.delete(k);
    slots.set(key, i);
    if (!images.has(icon) && !icon.startsWith('_')) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { for (const [k, v] of slots) if (k.startsWith(`${icon}|`)) drawBubble(v, k); };
      img.onerror = () => { console.error(`badge icon ${icon} failed to load`); };
      img.src = iconUrl(icon, 128);
      images.set(icon, img);
    }
    drawBubble(i, key);
    return i;
  }

  let cap = 32;
  let mesh = null;
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const uMotion = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uMap: { value: tex }, uTime: WORLD.uTime, uMotion, uNight: WORLD.uNight },
    vertexShader: /* glsl */`
      attribute vec4 aPos;      // xyz world, w phase
      attribute vec4 aSlot;     // atlas slot (col, row), size scale, bob amount
      uniform float uTime;
      uniform float uMotion;
      varying vec2 vUv;
      void main() {
        vec4 mv = modelViewMatrix * vec4( aPos.xyz, 1.0 );
        // screen-stable: ~75 px at every zoom (visual-06); badgeSize() in JS is the same formula
        float size = clamp( -mv.z * ${BADGE.k}, ${BADGE.min}, ${BADGE.max} ) * aSlot.z;
        float bob = sin( uTime * 12.566 + aPos.w * 6.283 ) * 0.1 * size * uMotion * aSlot.w;   // 120 BPM
        mv.xy += position.xy * size + vec2( 0.0, size * 0.5 + bob );
        gl_Position = projectionMatrix * mv;
        vUv = ( vec2( aSlot.x, ${GRID - 1}.0 - aSlot.y ) + uv ) / ${GRID}.0;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform float uNight;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D( uMap, vUv );
        if ( c.a < 0.02 ) discard;
        c.rgb *= 1.0 - 0.18 * uNight;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
  });

  function build(n) {
    cap = n;
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const aSlot = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    aPos.setUsage(THREE.DynamicDrawUsage);
    aSlot.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', aPos);
    geo.setAttribute('aSlot', aSlot);
    if (!mesh) {
      mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'badges';
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      layer.add(mesh);
    }
  }
  build(cap);

  const items = new Map();                       // id -> { pos, slot, phase, scale, bob }
  let dirty = false;
  return {
    set(id, b) {
      if (!b) { if (items.delete(id)) dirty = true; return; }
      const slot = slotFor(b.icon, b.style, b.count);
      const prev = items.get(id);
      let phase = prev ? prev.phase : 0;
      if (!prev) { for (let i = 0; i < id.length; i++) phase = (phase * 31 + id.charCodeAt(i)) % 997; phase /= 997; }
      const pin = b.icon === '_water' || b.icon.startsWith('_pin:');
      items.set(id, { pos: b.pos.clone(), slot, phase, scale: b.scale ?? 1, bob: pin ? 0 : 1 });
      dirty = true;
    },
    get count() { return items.size; },
    setMotion(m) { uMotion.value = m === 'full' ? 1 : m === 'reduced' ? 0.4 : 0; },
    update() {
      if (dirty) {
        dirty = false;
        if (items.size > cap) build(Math.max(cap * 2, items.size));
        const aPos = geo.getAttribute('aPos');
        const aSlot = geo.getAttribute('aSlot');
        let i = 0;
        for (const it of items.values()) {
          aPos.setXYZW(i, it.pos.x, it.pos.y, it.pos.z, it.phase);
          aSlot.setXYZW(i, it.slot % GRID, Math.floor(it.slot / GRID), it.scale, it.bob);
          i++;
        }
        geo.instanceCount = i;
        aPos.needsUpdate = true;
        aSlot.needsUpdate = true;
      }
      if (mesh) mesh.visible = items.size > 0;
      if (!items.size || uMotion.value <= 0) return 0;
      for (const it of items.values()) if (it.bob) return 1;   // only bobbing bubbles need frames (pins sit still)
      return 0;
    },
  };
}
