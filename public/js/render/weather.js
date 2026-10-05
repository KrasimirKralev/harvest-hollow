// Weather on screen (GDD §5.10, §8.4): sunny / cloudy / light rain / windy per real hour, shared by both
// players because it is a pure function of the farm seed and the hour. Rain darkens the sky and the ground
// (wetness lingers and dries), streaks fall (fx.rain), windy bends the crops harder. Owned by the
// render-world lane.
//
// The RULES own the weather (rain waters crops at the start of a rain hour, GDD §5.10), so the source of
// truth is `weatherAt(farmSeed, hourIndex)` in shared/rules. Until that module exists this file carries a
// compatible implementation (the same distribution, documented in docs/agent-notes/render-world.md), and
// `setWeatherSource(fn)` switches to the rules' function so the sky can never disagree with the rules.
//
//   weatherAt(farmSeed, hourIndex) -> 'sunny' | 'cloudy' | 'rain' | 'windy'     (fallback; pure, tested)
//   setWeatherSource(fn | null)
//   createWeather() -> w
//     w.update(now, dt, { farmSeed, season, override? }) -> { kind, rain, wet, cloud, wind, changed }
//        smoothed 0..1 levels: rain (streak intensity), wet (ground darkening, dries slowly), cloud, wind (x)
//     w.force(kind | null)          dev/look-dev override ('rain', 'sunny', ...)
// Wave 4 (owner wish 12, "improve the rain"): update() also returns
//     strength   0..1.15  how hard it rains: a rain hour is a drizzle (0.45) or a downpour (1), gusting slowly
//     puddle     0..1     puddles fill over ~2 min of rain and dry over ~8 min after
//     rainbow    0..1     the first 3 minutes after some rain hours (both screens agree: seed and hour); the sky shows
//                          it by day only
//   rainStyle(farmSeed, hourIndex) -> { downpour, rainbow }   pure (tested)
export const HOUR_MS = 3_600_000;
const KINDS = ['sunny', 'cloudy', 'rain', 'windy'];

/** FNV-1a 32 over two integers (stable on every engine). */
function mix32(a, b) {
  let h = 2166136261;
  const s = `${a >>> 0}|${b}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return h >>> 0;
}

/** Compatible fallback for the rules' weatherAt: sunny 70 %, cloudy 15 %, rain 12 %, windy 3 %. */
export function weatherAt(farmSeed, hourIndex) {
  const r = mix32(farmSeed | 0, hourIndex | 0) % 10000;
  if (r < 7000) return 'sunny';
  if (r < 8500) return 'cloudy';
  if (r < 9700) return 'rain';
  return 'windy';
}

/** How a rain hour rains (pure, deterministic): a downpour about 45 % of the time, else a drizzle; whether a rainbow
 *  follows it (4 in 7). */
export function rainStyle(farmSeed, hourIndex) {
  const r = mix32((farmSeed | 0) ^ 0x5BD1, hourIndex | 0) % 700;
  return { downpour: r % 100 < 45, rainbow: Math.floor(r / 100) < 4 };
}
export const RAINBOW_MS = 180_000;

let source = weatherAt;
export function setWeatherSource(fn) { source = typeof fn === 'function' ? fn : weatherAt; }

const TARGET = {
  sunny: { rain: 0, cloud: 0.15, wind: 1 },
  cloudy: { rain: 0, cloud: 1, wind: 1.15 },
  rain: { rain: 1, cloud: 1, wind: 1.25 },
  windy: { rain: 0, cloud: 0.35, wind: 1.6 },
};

const approach = (cur, goal, perSec, dt) => (cur < goal ? Math.min(goal, cur + perSec * dt) : Math.max(goal, cur - perSec * dt));

export function createWeather() {
  const lv = { rain: 0, wet: 0, cloud: 0.15, wind: 1, strength: 0.45, puddle: 0 };
  let forced = null;
  let kind = 'sunny';
  let primed = false;
  let prevHour = null; let prevRain = false; let forcedBow = false;
  const out = { kind: 'sunny', changed: false, rain: 0, wet: 0, cloud: 0.15, wind: 1, strength: 0.45, puddle: 0, rainbow: 0 };   // reused: no garbage per frame
  return {
    /** Dev / look-dev override; the new weather shows at once (no 20 s build-up). */
    force(k) {
      // look-dev: 'rainbow' is a sunny sky just after a shower (wave 4)
      forcedBow = k === 'rainbow';
      if (forcedBow) k = 'sunny';
      forced = KINDS.includes(k) ? k : null;
      if (forced) { const t = TARGET[forced]; Object.assign(lv, { rain: t.rain, cloud: t.cloud, wind: t.wind, wet: t.rain, puddle: t.rain, strength: 1 }); kind = forced; primed = true; }
      prevHour = null;
    },
    get kind() { return kind; },
    update(now, dt, { farmSeed = 0, override = null } = {}) {
      const k = forced || override || source(farmSeed, Math.floor(now / HOUR_MS));
      const changed = k !== kind;
      kind = KINDS.includes(k) ? k : 'sunny';
      const t = TARGET[kind];
      const hour = Math.floor(now / HOUR_MS);
      if (hour !== prevHour) { prevHour = hour; prevRain = !forced && source(farmSeed, hour - 1) === 'rain'; }
      const style = kind === 'rain' ? rainStyle(farmSeed, hour) : null;
      const strGoal = style ? (style.downpour || forced === 'rain' ? 1 : 0.45) : lv.strength;
      if (!primed) {
        // The first frame shows the current weather as it is (no fade-in from sunny on every page load).
        primed = true;
        Object.assign(lv, { rain: t.rain, cloud: t.cloud, wind: t.wind, wet: t.rain, strength: strGoal, puddle: t.rain });
      } else {
        lv.rain = approach(lv.rain, t.rain, 1 / 20, dt);          // showers build over 20 s
        lv.cloud = approach(lv.cloud, t.cloud, 1 / 25, dt);
        lv.wind = approach(lv.wind, t.wind, 1 / 8, dt);
        lv.wet = lv.rain > lv.wet ? approach(lv.wet, lv.rain, 1 / 30, dt) : approach(lv.wet, lv.rain, 1 / 180, dt);  // dries in ~3 min
        lv.strength = approach(lv.strength, strGoal, 1 / 15, dt);
        lv.puddle = lv.rain > 0.5 ? approach(lv.puddle, 1, 1 / 120, dt) : approach(lv.puddle, 0, 1 / 480, dt);
      }
      // a rainbow for the first minutes after a rain hour that has one (fades in over 20 s and out over 30 s)
      const since = now - hour * HOUR_MS;
      const bow = kind !== 'rain' && prevRain && rainStyle(farmSeed, hour - 1).rainbow && since < RAINBOW_MS
        ? Math.max(0, Math.min(1, since / 20_000, (RAINBOW_MS - since) / 30_000)) : 0;
      out.kind = kind; out.changed = changed;
      out.rain = lv.rain; out.wet = lv.wet; out.cloud = lv.cloud; out.wind = lv.wind;
      // gusts: the shower swells and eases over ~40 s (a slow beat of two sines; both screens share server time)
      out.strength = lv.strength * (1 + 0.13 * Math.sin(now / 6400) * Math.sin(now / 17_000 + 1.3));
      out.puddle = lv.puddle; out.rainbow = forcedBow ? 1 : bow;
      return out;
    },
  };
}
