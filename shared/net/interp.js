// Remote presence interpolation (tech-architecture §6.2). Pure: time is a parameter.
// Render remote avatars INTERP_DELAY_MS in the past, lerp between bracketing samples, extrapolate up to
// EXTRAPOLATE_MS past the newest one, then hold. Facing uses the shortest arc. An idle sample (anim `a` 0)
// is never extrapolated: the sender's last `mv` of a walk says a: 0, so a stopped partner never overshoots.
// Samples are pushed with the ROW time (`pr` row[7]), not the batch time (review-m0 M3).
import { LIMITS } from './protocol.js';

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class PresenceBuffer {
  constructor(max = 32) { this.max = max; /** @type {Array<{ts,x,z,f,a,cx,cz,tool}>} */ this.s = []; }

  /** Add a sample (server-stamped `ts`); out-of-order samples are dropped. */
  push(ts, x, z, f, a, cx = null, cz = null, tool = null) {
    const last = this.s.at(-1);
    if (last && ts <= last.ts) return;
    this.s.push({ ts, x, z, f, a, cx, cz, tool });
    if (this.s.length > this.max) this.s.shift();
  }

  /** Forget every sample (a hop: the next sample is drawn at once, never interpolated toward). */
  clear() { this.s = []; }

  /** Pose at server time `t` (already delayed by the caller, or use at()). null when empty. */
  sample(t) {
    const s = this.s;
    if (!s.length) return null;
    if (t <= s[0].ts) return { ...s[0] };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (t >= a.ts && t <= b.ts) {
        const k = b.ts === a.ts ? 1 : (t - a.ts) / (b.ts - a.ts);
        return {
          ts: t, x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), f: lerpAngle(a.f, b.f, k), a: k < 0.5 ? a.a : b.a, tool: b.tool,
          cx: b.cx === null || a.cx === null ? b.cx : lerp(a.cx, b.cx, k),
          cz: b.cz === null || a.cz === null ? b.cz : lerp(a.cz, b.cz, k),
        };
      }
    }
    const b = s.at(-1);
    const a = s.length > 1 ? s.at(-2) : null;
    const over = Math.min(t - b.ts, LIMITS.EXTRAPOLATE_MS);
    if (!a || b.ts === a.ts || over <= 0 || b.a === 0) return { ...b };
    const vx = (b.x - a.x) / (b.ts - a.ts);
    const vz = (b.z - a.z) / (b.ts - a.ts);
    return { ...b, ts: t, x: b.x + vx * over, z: b.z + vz * over };
  }

  /** Pose to render at estimated server time `serverNow`. */
  at(serverNow) { return this.sample(serverNow - LIMITS.INTERP_DELAY_MS); }
}
