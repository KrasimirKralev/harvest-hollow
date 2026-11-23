// Speak to the helper, hear its answer (Harness Hollow, ui lane; contract overview item 5). The browser's own Web
// Speech API: speech-to-text needs a secure context (https or localhost; the partner's http://192.168... page has none,
// so the 🎙 button is hidden there) and may use the browser maker's online service (the privacy page says so);
// read-aloud (speechSynthesis) works everywhere it exists. No dependency, no recording kept: the words go into the
// request box and nowhere else.
//
//   LOCALE                                  { en: 'en-US', bg: 'bg-BG' }
//   createDictation({ win }) -> { supported, why, listening, start(lang, { onText(text, final), onEnd(reason), onError(code) }), stop() }
//     why: null | 'insecure' | 'missing'    onError codes: 'blocked' (no microphone permission) | 'silence' | 'network' | 'other'
//   createReader({ win }) -> { supported, speaking, speak(text, lang, { onEnd }), stop() }

export const LOCALE = Object.freeze({ en: 'en-US', bg: 'bg-BG' });

const ERRORS = { 'not-allowed': 'blocked', 'service-not-allowed': 'blocked', 'audio-capture': 'blocked', 'no-speech': 'silence', network: 'network' };

/** Speech-to-text for the request box. */
export function createDictation({ win = globalThis } = {}) {
  const Rec = win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
  const secure = win?.isSecureContext !== false;
  const why = !Rec ? 'missing' : !secure ? 'insecure' : null;
  let rec = null;
  let ended = true;
  const api = {
    supported: why === null,
    why,
    get listening() { return Boolean(rec) && !ended; },
    start(lang, { onText = () => {}, onEnd = () => {}, onError = () => {} } = {}) {
      if (!api.supported) { onError(why === 'insecure' ? 'blocked' : 'other'); return false; }
      api.stop();
      let r;
      try {
        r = new Rec();
      } catch {
        onError('other');
        return false;
      }
      r.lang = LOCALE[lang] || LOCALE.en;
      r.interimResults = true;
      r.continuous = false;        // one phrase per press: iOS Safari stops a continuous session on its own anyway
      r.maxAlternatives = 1;
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex ?? 0; i < (e.results?.length ?? 0); i++) {
          const res = e.results[i];
          const said = String(res?.[0]?.transcript ?? '');
          if (res?.isFinal) finalText += said;
          else interim += said;
        }
        onText((finalText + interim).replace(/\s+/g, ' ').trim(), !interim);
      };
      r.onerror = (e) => { onError(ERRORS[e?.error] ?? 'other'); };
      r.onend = () => {
        if (rec !== r) return;
        ended = true;
        rec = null;
        onEnd(finalText ? 'done' : 'empty');
      };
      rec = r;
      ended = false;
      try {
        r.start();
      } catch {
        rec = null;
        ended = true;
        onError('other');
        return false;
      }
      return true;
    },
    stop() {
      const r = rec;
      if (!r) return;
      try { r.stop(); } catch { /* already stopped */ }
    },
  };
  return api;
}

/** Read-aloud of the helper's summary. */
export function createReader({ win = globalThis } = {}) {
  const synth = win?.speechSynthesis ?? null;
  const Utter = win?.SpeechSynthesisUtterance ?? null;
  let current = null;
  const api = {
    supported: Boolean(synth && Utter),
    get speaking() { return Boolean(current); },
    speak(text, lang, { onEnd = () => {} } = {}) {
      if (!api.supported || !text) return false;
      api.stop();
      const u = new Utter(String(text));
      const want = LOCALE[lang] || LOCALE.en;
      u.lang = want;
      // a voice of that language when the device has one (a Bulgarian text in an English voice is hard to follow)
      try {
        const voices = synth.getVoices?.() ?? [];
        const v = voices.find((x) => String(x.lang).toLowerCase() === want.toLowerCase())
          ?? voices.find((x) => String(x.lang).toLowerCase().startsWith(`${lang}-`) || String(x.lang).toLowerCase() === lang);
        if (v) u.voice = v;
      } catch { /* no voice list: the browser picks by u.lang */ }
      const done = () => { if (current === u) { current = null; onEnd(); } };
      u.onend = done;
      u.onerror = done;
      current = u;
      try {
        synth.speak(u);
      } catch {
        current = null;
        return false;
      }
      return true;
    },
    stop() {
      if (!current) return;
      const u = current;
      current = null;
      try { synth.cancel(); } catch { /* nothing playing */ }
      u.onend = null;
    },
  };
  return api;
}
