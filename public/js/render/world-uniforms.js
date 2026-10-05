// Shared world uniforms and the wind/cursor sway patch (visual-ux-juice §4.3, GDD §8.4). Owned by the
// render-world lane. ONE uniform object is shared by reference into every patched material, so a frame
// writes uTime once and every swaying crop, tree, tuft and the water move together on the 60 BPM grid.
//
//   WORLD                 { uTime, uWindDir, uWind, uCursorA, uCursorB, uSeason, uWet, uNight, uGold }
//                         uCursorA/B: xyz ground point (metres), w = 0..1 presence of the local / partner hand
//   addSway(material, { stiffness = 1, push = 1 })   composes the sway patch onto a material (models.js
//                         addShaderPatch, so render-life's wrap lighting stays). Geometry must carry the
//                         `sway` float attribute (bend weight; 0 = rigid), as every models.js geometry does.
//   addFoliageTint(material)   season + wetness tint on lit foliage (winter frost on up-facing leaves)
//   cursors               { setA(x, z, on), setB(x, z, on), update(dt) -> boolean moving }   eased hands of wind
//   easeToward(cur, target, rate, dt)    exponential approach (pure, tested)
//   SEASON_INDEX          spring 0, summer 1, autumn 2, winter 3
import * as THREE from 'three';
import { addShaderPatch } from './models.js';

export const SEASON_INDEX = Object.freeze({ spring: 0, summer: 1, autumn: 2, winter: 3 });

export const WORLD = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWind: { value: 0.085 },                                 // metres of tip sway at bend weight 1
  uCursorA: { value: new THREE.Vector4(0, 0, 0, 0) },
  uCursorB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSeason: { value: 1 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  uGold: { value: 0 },
};

/** Frame-rate independent exponential approach of `cur` to `target` (rate per second). */
export function easeToward(cur, target, rate, dt) {
  return target + (cur - target) * Math.exp(-rate * Math.max(0, dt));
}

const SWAY_PARS = /* glsl */`
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWind;
uniform vec4 uCursorA;
uniform vec4 uCursorB;
uniform float uSwayStiff;
uniform float uSwayPush;
attribute float sway;
vec2 hhPush( vec4 c, vec2 p ) {
  vec2 d = p - c.xz;
  float r = length( d ) + 1e-3;
  float k = c.w * ( 1.0 - smoothstep( 0.3, 2.6, r ) );   // a 2.6 m "hand of wind"
  return ( d / r ) * k * 0.32;
}
`;

const SWAY_MAIN = /* glsl */`
#include <project_vertex>
{
  #ifdef USE_BATCHING
    mat4 hhInst = batchingMatrix;
  #elif defined( USE_INSTANCING )
    mat4 hhInst = instanceMatrix;
  #else
    mat4 hhInst = mat4( 1.0 );
  #endif
  vec3 hhRoot = ( modelMatrix * hhInst * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vec3 hhPos = ( modelMatrix * hhInst * vec4( position, 1.0 ) ).xyz;
  float ph = dot( hhRoot.xz, vec2( 0.21, 0.17 ) );                  // neighbours sway together: a wave over the field
  float ph2 = ph + dot( position.xz, vec2( 2.3, 1.7 ) );            // plants of one cluster drift apart a little
  float slow = sin( uTime * 3.14159 + ph );                         // 2 s period = two beats at 60 BPM
  float flutter = 0.28 * sin( uTime * 6.28318 + ph2 * 3.1 );
  vec2 s = uWindDir * ( 0.3 + 0.8 * slow + flutter ) * uWind / uSwayStiff;
  s += ( hhPush( uCursorA, hhPos.xz ) + hhPush( uCursorB, hhPos.xz ) ) * uSwayPush;
  vec3 hhOff = vec3( s.x, -0.45 * dot( s, s ), s.y ) * sway;
  mvPosition.xyz += ( viewMatrix * vec4( hhOff, 0.0 ) ).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Wind sway + both players' cursor push on a material whose geometry carries `sway`. */
export function addSway(material, { stiffness = 1, push = 1 } = {}) {
  const uStiff = { value: stiffness };
  const uPush = { value: push };
  addShaderPatch(material, 'hh-sway', (shader) => {
    Object.assign(shader.uniforms, {
      uTime: WORLD.uTime, uWindDir: WORLD.uWindDir, uWind: WORLD.uWind,
      uCursorA: WORLD.uCursorA, uCursorB: WORLD.uCursorB, uSwayStiff: uStiff, uSwayPush: uPush,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_PARS}`)
      .replace('#include <project_vertex>', SWAY_MAIN);
  }, 'v1');
  material.userData.sway = { stiffness: uStiff, push: uPush };
  return material;
}

const TINT_PARS = /* glsl */`
uniform float uSeason;
uniform float uWet;
uniform float uNight;
uniform float uGold;
uniform float uAutumnK;
uniform float uWinterK;
varying vec3 hhWorldN;
varying vec3 hhRootW;
`;

/**
 * Season and rain on foliage-ish materials: autumn turns greens toward gold, orange and red (per plant, by
 * where it stands: a grove is never one flat colour), winter frosts up-facing surfaces, rain darkens and
 * deepens. `autumn` scales the autumn colouring (trees 1, tufts 0.5, crops 0: crops keep their own colours);
 * `winter` the frost (crops 0.25: a ripe winter cabbage must still read as ripe).
 */
export function addFoliageTint(material, { autumn = 1, winter = 1 } = {}) {
  const uAutumnK = { value: autumn };
  const uWinterK = { value: winter };
  addShaderPatch(material, 'hh-tint', (shader) => {
    shader.uniforms.uSeason = WORLD.uSeason;
    shader.uniforms.uWet = WORLD.uWet;
    shader.uniforms.uNight = WORLD.uNight;
    shader.uniforms.uGold = WORLD.uGold;
    shader.uniforms.uAutumnK = uAutumnK;
    shader.uniforms.uWinterK = uWinterK;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 hhWorldN;\nvarying vec3 hhRootW;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        #ifdef USE_BATCHING
          hhWorldN = normalize( mat3( modelMatrix ) * mat3( batchingMatrix ) * objectNormal );
          hhRootW = ( modelMatrix * batchingMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #elif defined( USE_INSTANCING )
          hhWorldN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );
          hhRootW = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #else
          hhWorldN = normalize( mat3( modelMatrix ) * objectNormal );
          hhRootW = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TINT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float green = clamp( ( c.g - max( c.r, c.b ) ) * 5.0, 0.0, 1.0 );    // only leafy greens shift
          green *= smoothstep( 0.1, 0.19, dot( c, vec3( 0.3, 0.59, 0.11 ) ) );  // dark evergreens (pines) stay green
          // spring: new leaves, lighter and a touch yellow-green (visual-after: spring looked like summer)
          float spring = ( 1.0 - smoothstep( 0.4, 0.9, uSeason ) ) * step( 0.01, uAutumnK );
          c = mix( c, c * vec3( 1.1, 1.14, 0.85 ), spring * green * 0.8 );
          float autumn = smoothstep( 1.5, 2.0, uSeason ) * ( 1.0 - smoothstep( 2.6, 3.0, uSeason ) ) * uAutumnK;
          // the plant's root, interpolated, wobbles by float noise: objects stand on whole or half metres, so floor()
          // must never sit on those (it flipped per pixel: the orange "weave" on autumn crowns, visual-16)
          float pick = fract( sin( dot( floor( hhRootW.xz * 0.5 + 0.25 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          // RD-05 (QA wave 2): 70 % of the deciduous crowns turn ochre #C49A45, copper #B86A39 or muted red #A85C45
          // (the leaf's own light and shade kept: the hue is set, the value follows the green it replaces); the rest
          // only begin to turn
          float lv = clamp( dot( c, vec3( 0.3, 0.59, 0.11 ) ) / 0.24, 0.45, 1.45 );
          vec3 ochre = vec3( 0.552, 0.323, 0.058 );
          vec3 copper = vec3( 0.479, 0.145, 0.041 );
          vec3 red = vec3( 0.392, 0.108, 0.059 );
          vec3 fall = ( pick < 0.32 ? ochre : pick < 0.56 ? copper : red ) * lv;
          float turned = pick < 0.7 ? 0.92 : 0.3;
          c = mix( c, pick < 0.7 ? fall : mix( c, ochre * lv, 0.6 ), autumn * green * turned );
          float winter = smoothstep( 2.5, 3.0, uSeason ) * ( 1.0 - smoothstep( 3.6, 4.0, uSeason ) );
          float up = smoothstep( 0.55, 0.9, hhWorldN.y );
          c = mix( c, vec3( 0.93, 0.96, 1.0 ), winter * up * 0.8 * uWinterK );
          c *= 1.0 - 0.1 * uWet;
          // moonlight grade: colours cool and quieten at night (the light alone keeps greens too green)
          float lum = dot( c, vec3( 0.3, 0.59, 0.11 ) );
          c = mix( c, vec3( lum ) * vec3( 0.92, 0.88, 1.12 ), uNight * 0.55 );
          // Golden Hour: greens stay green (RD-05: the warm key light does the work, no yellow paint)
          diffuseColor.rgb = c;
        }`);
  }, 'v10');
  material.userData.autumn = uAutumnK;
  return material;
}

/** Two eased "hands of wind": my cursor (A) and the partner's (B). Positions in metres. */
function createCursors() {
  const goal = { A: { x: 0, z: 0, w: 0 }, B: { x: 0, z: 0, w: 0 } };
  const uni = { A: WORLD.uCursorA.value, B: WORLD.uCursorB.value };
  const set = (k, x, z, on) => {
    const g = goal[k];
    if (Number.isFinite(x) && Number.isFinite(z)) {
      // A hand that appears far away jumps there invisibly instead of sweeping across the field.
      if (uni[k].w < 0.02) { uni[k].x = x; uni[k].z = z; }
      g.x = x; g.z = z;
    }
    g.w = on ? 1 : 0;
  };
  return {
    setA(x, z, on = true) { set('A', x, z, on); },
    setB(x, z, on = true) { set('B', x, z, on); },
    /** Ease both hands (8/s glide, 6/s fade). Returns true while either still moves. */
    update(dt) {
      let moving = false;
      for (const k of ['A', 'B']) {
        const u = uni[k];
        const g = goal[k];
        const nx = easeToward(u.x, g.x, 8, dt);
        const nz = easeToward(u.z, g.z, 8, dt);
        const nw = easeToward(u.w, g.w, 6, dt);
        if (Math.abs(nx - u.x) + Math.abs(nz - u.z) > 1e-3 || Math.abs(nw - u.w) > 1e-3) moving = true;
        u.x = nx; u.z = nz; u.w = nw;
      }
      return moving;
    },
  };
}

export const cursors = createCursors();
