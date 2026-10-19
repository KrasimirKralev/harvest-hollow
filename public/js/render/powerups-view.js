// The balloon crates' power-ups on the farm (release 1.0, owner request 2026-10-19; rules shared/rules/powerups.js): a
// light trickle of the existing fx particles where each one works, while it works, on both screens (the state is the
// farm's): rainbow sparkles and drops over the plots (Rainbow Watering Can), red ladybugs over the growing crops, bees
// round the animal homes and trees, gold over Mabel's Order Board (Golden Ticket), and now and then a shooting star
// across the sky with a glitter trail under the balloon (Shooting Star). Lazy: ambient-life.js imports it the first time
// the farm has a power-up. Ambient particles (never the interactive frame rate), scaled by the tier's k; ambient-life
// skips it under Still.
//   createPowerupsView({ now, balloonAt? }) -> { update(dt, { fx, state, focus, k }) -> 0 | 1 }
import * as THREE from 'three';
import { TILE_M } from '../../../shared/content/config.js';
import { defOf } from '../../../shared/content/index.js';
import { livePowerups } from '../../../shared/rules/powerups.js';

const RAINBOW = ['#FF7A6B', '#FFC83D', '#9BE06A', '#4AA8E8', '#A98BE0'];
const NEAR2 = 30 * 30;                 // metres² round the camera's target where the trickle plays
const RATE = { rainbow: 4, ladybugs: 6, swarm: 4, ticket: 3, star: 0.15 };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const jit = (r) => (Math.random() - 0.5) * r;

export function createPowerupsView({ now, balloonAt = null } = {}) {
  const v3 = new THREE.Vector3();
  const acc = {};
  let clock = 0;
  let spots = null;
  let spotsAt = -10;
  let comet = null;

  /** Where the power-ups work near the focus (metres), re-read every 2 s at most: plots, crops, homes and trees, the board. */
  function where(state, focus) {
    if (spots && clock - spotsAt < 2) return spots;
    spotsAt = clock;
    const s = { plots: [], crops: [], life: [], board: [] };
    for (const o of Object.values(state.farm.objects)) {
      const d = defOf(o.def);
      if (!d || !Number.isFinite(o.x)) continue;
      const [w, h] = (o.rot ?? 0) % 2 ? [d.size?.[1] ?? 1, d.size?.[0] ?? 1] : [d.size?.[0] ?? 1, d.size?.[1] ?? 1];
      const x = (o.x + w / 2) * TILE_M;
      const z = (o.z + h / 2) * TILE_M;
      if ((x - focus.x) * (x - focus.x) + (z - focus.z) * (z - focus.z) > NEAR2) continue;
      if (d.kind === 'plot') { s.plots.push([x, z]); if (o.crop) s.crops.push([x, z]); }
      else if (d.kind === 'tree' || d.kind === 'home') s.life.push([x, z, w * TILE_M]);
      else if (o.def === 'order_board') s.board.push([x, z]);
    }
    spots = s;
    return s;
  }

  let ringAt = 0;
  const SPAWN = {
    rainbow(fx, s) {
      if (!s.plots.length) return;
      const [x, z] = pick(s.plots);
      fx.burst('sparkle', v3.set(x + jit(1.4), 0.3, z + jit(1.4)), { n: 2, colors: RAINBOW, speed: 0.15, up: 0.7, size: 0.7,
        sizeEnd: 0.15, life: 1.8, grav: -0.03, spread: 0.3, spin: 1, y: 0, additive: true, ambient: true });
      if (Math.random() < 0.4) {
        fx.burst('droplet', v3.set(x + jit(1), 1.8, z + jit(1)), { n: 2, color: '#9ED8FF', speed: 0.15, up: -0.4, grav: 1.4,
          size: 0.22, life: 0.7, y: 0, ambient: true });
      }
      // now and then a soft rainbow ring on a plot (one ring at a time: the shared pool has twelve)
      if (clock - ringAt > 1.4) {
        ringAt = clock;
        fx.ring(v3.set(x, 0.06, z), { color: RAINBOW[Math.floor(clock) % RAINBOW.length], radius: 1.4, duration: 1.3, width: 0.22, opacity: 0.7 });
      }
    },
    ladybugs(fx, s) {
      const from = s.crops.length ? s.crops : s.plots;
      if (!from.length) return;
      const [x, z] = pick(from);
      fx.burst('glow', v3.set(x + jit(1.4), 0.5 + Math.random() * 0.4, z + jit(1.4)), { n: 1, colors: ['#E8463A', '#D2352B'],
        speed: 0.4, up: 0.15, size: 0.45, sizeEnd: 0.4, life: 2.6, grav: 0, spread: 0.2, alpha: 0.95, additive: false, ambient: true });
    },
    swarm(fx, s) {
      if (!s.life.length) return;
      const [x, z, r] = pick(s.life);
      fx.burst('glow', v3.set(x + jit(r + 1), 0.9 + Math.random() * 1.4, z + jit(r + 1)), { n: 3, colors: ['#FFC83D', '#FFD45A', '#5C3B1E'],
        speed: 1, up: 0.3, size: 0.38, sizeEnd: 0.32, life: 1.6, grav: 0, spread: 0.5, additive: false, ambient: true });
    },
    ticket(fx, s) {
      if (!s.board.length) return;
      const [x, z] = s.board[0];
      fx.burst(Math.random() < 0.25 ? 'coin' : 'sparkle', v3.set(x + jit(2), 1.8 + Math.random() * 1, z + jit(1.2)), { n: 1,
        colors: ['#FFE27A', '#FFFFFF', '#FFC83D'], speed: 0.3, up: 0.5, size: 0.5, sizeEnd: 0.12, life: 1.5, grav: -0.02,
        spread: 0.3, spin: 2, y: 0, ambient: true });
    },
    star(fx, s, focus) {
      // a shooting star: 18 m across the sky in 0.9 s (its trail is drawn in update)
      const a = Math.random() * Math.PI * 2;
      const from = new THREE.Vector3(focus.x + Math.cos(a) * 14, 14 + Math.random() * 4, focus.z - 10 + Math.sin(a) * 6);
      comet = { t: 0, from, to: from.clone().add(new THREE.Vector3(-Math.cos(a) * 18, -4, -Math.sin(a) * 4)) };
    },
  };

  // Mabel's board glints while a Golden Ticket waits (persistent twinkles, taken away when it is used or over)
  const glints = new Set();
  function boardGlints(fx, s, on) {
    const want = on && s.board.length ? s.board[0] : null;
    for (const key of glints) if (!want || !key.endsWith(`:${want[0]},${want[1]}`)) { fx.twinkle(key, null); glints.delete(key); }
    if (!want) return;
    [[-0.9, 2.2], [0.8, 2.6], [0.1, 1.9]].forEach(([dx, y], i) => {
      const key = `pu-ticket${i}:${want[0]},${want[1]}`;
      if (glints.has(key)) return;
      glints.add(key);
      fx.twinkle(key, v3.set(want[0] + dx, y, want[1]), { color: '#FFE27A', size: 0.9 });
    });
  }

  return {
    update(dt, { fx, state, focus, k = 1 }) {
      clock += dt;
      if (!fx || !state?.farm?.powerups || !focus) return 0;
      const live = livePowerups(state, now());
      if (!live.length && !comet && !glints.size) return 0;
      const s = where(state, focus);
      boardGlints(fx, s, live.some((p) => p.id === 'ticket'));
      for (const p of live) {
        acc[p.id] = (acc[p.id] ?? 0) + dt * RATE[p.id] * k;
        for (; acc[p.id] >= 1; acc[p.id] -= 1) SPAWN[p.id](fx, s, focus);
      }
      if (comet) {
        comet.t += dt / 0.9;
        v3.lerpVectors(comet.from, comet.to, Math.min(1, comet.t));
        fx.burst('star', v3, { n: 1, colors: ['#FFFFFF', '#FFE27A', '#BFE6FF'], speed: 0.05, up: 0, size: 0.8, sizeEnd: 0.08,
          life: 0.55, grav: 0.1, spread: 0, spin: 2, y: 0, additive: true, ambient: true });
        if (comet.t >= 1) comet = null;
      }
      // the balloon that will surely drop a crate trails glitter while it flies
      const b = live.some((p) => p.id === 'star') && balloonAt ? balloonAt(now()) : null;
      if (b && Math.random() < dt * 3 * k) {
        fx.burst('sparkle', v3.set(b.x + jit(1), b.y - 3, b.z + jit(1)), { n: 1, colors: ['#FFE27A', '#FFFFFF'], speed: 0.2, up: -0.6,
          size: 0.4, sizeEnd: 0.1, life: 1.6, grav: 0.05, spread: 0.3, spin: 2, y: 0, additive: true, ambient: true });
      }
      return live.length || comet ? 1 : 0;
    },
  };
}
