// Music, woodland ambience and action cues (port of scripts/sound.gd): the original synthesized WAVs from the Godot
// project. Browsers start audio only after a click or key, so everything waits for the first gesture.
export function createSound(state) {
  const base = 'assets/audio/';
  let music = null; let ambience = null; let started = false;
  const pool = [];
  function start() {
    if (started || typeof Audio === 'undefined') return;
    started = true;
    music = new Audio(`${base}meadow.wav`); music.loop = true;
    ambience = new Audio(`${base}breeze.wav`); ambience.loop = true;
    volumes();
    music.play().catch(() => {});
    ambience.play().catch(() => {});
  }
  function volumes() {
    if (music) music.volume = Math.min(1, state.settings.music * 0.65);
    if (ambience) ambience.volume = Math.min(1, state.settings.ambience * 0.6);
  }
  function play(cue = 'pick') {
    if (!started || typeof Audio === 'undefined') return;
    let a = pool.find((x) => x.paused || x.ended);
    if (!a) { if (pool.length >= 4) a = pool.shift(); else a = new Audio(); pool.push(a); }
    a.src = `${base}${cue}.wav`;
    a.volume = Math.min(1, state.settings.effects * 0.7);
    a.play().catch(() => {});
  }
  return { start, play, volumes };
}
