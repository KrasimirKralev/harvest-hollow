// Speak to the helper and hear it (public/js/ui/harness/voice.js), against stand-ins of the Web Speech API: the 🎙 is
// offered only where the browser has speech recognition AND the page is a secure context (the partner's http://192.168…
// page is not), it listens in the game's language, interim words show as they come and the final text stays; refusals
// become the four reasons the panel words. Read-aloud picks a voice of the language and stops on demand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDictation, createReader, LOCALE } from '../public/js/ui/harness/voice.js';

class FakeRec {
  static last = null;
  constructor() { FakeRec.last = this; this.started = false; this.stopped = false; }
  start() { this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  say(parts) {
    // parts: [[text, final], ...] as one SpeechRecognitionEvent
    const results = parts.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

test('speech-to-text is offered only with the API and a secure context', () => {
  assert.deepEqual([createDictation({ win: {} }).supported, createDictation({ win: {} }).why], [false, 'missing']);
  const http = createDictation({ win: { webkitSpeechRecognition: FakeRec, isSecureContext: false } });
  assert.deepEqual([http.supported, http.why], [false, 'insecure']);
  const ok = createDictation({ win: { SpeechRecognition: FakeRec, isSecureContext: true } });
  assert.deepEqual([ok.supported, ok.why], [true, null]);
  const errs = [];
  assert.equal(http.start('en', { onError: (c) => errs.push(c) }), false);
  assert.deepEqual(errs, ['blocked']);
});

test('it listens in the game language, shows interim words, keeps the final text, and ends', () => {
  const d = createDictation({ win: { webkitSpeechRecognition: FakeRec, isSecureContext: true } });
  const seen = [];
  const ends = [];
  assert.equal(d.start('bg', { onText: (txt, fin) => seen.push([txt, fin]), onEnd: (r) => ends.push(r) }), true);
  const r = FakeRec.last;
  assert.equal(r.lang, LOCALE.bg);
  assert.equal(r.interimResults, true);
  assert.equal(r.started, true);
  assert.equal(d.listening, true);
  r.say([['Лунен', false]]);
  r.say([['Лунен пъпеш', true]]);
  assert.deepEqual(seen, [['Лунен', false], ['Лунен пъпеш', true]]);
  d.stop();
  assert.equal(r.stopped, true);
  assert.equal(d.listening, false);
  assert.deepEqual(ends, ['done']);
});

test('refusals are told apart: blocked microphone, silence, network, anything else', () => {
  const d = createDictation({ win: { SpeechRecognition: FakeRec } });
  const codes = [];
  for (const e of ['not-allowed', 'service-not-allowed', 'no-speech', 'network', 'aborted']) {
    d.start('en', { onError: (c) => codes.push(c) });
    FakeRec.last.onerror({ error: e });
  }
  assert.deepEqual(codes, ['blocked', 'blocked', 'silence', 'network', 'other']);
});

test('read-aloud: a voice of the language when there is one, a stop that cancels, nothing without the API', () => {
  const spoken = [];
  let cancelled = 0;
  class Utter { constructor(text) { this.text = text; } }
  const synth = { getVoices: () => [{ lang: 'en-US', name: 'A' }, { lang: 'bg-BG', name: 'Б' }], speak: (u) => spoken.push(u), cancel: () => { cancelled++; } };
  const r = createReader({ win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utter } });
  assert.equal(r.supported, true);
  let ended = 0;
  assert.equal(r.speak('Добавих лунен пъпеш.', 'bg', { onEnd: () => { ended++; } }), true);
  assert.equal(spoken[0].lang, 'bg-BG');
  assert.equal(spoken[0].voice.name, 'Б');
  assert.equal(r.speaking, true);
  spoken[0].onend();
  assert.equal(ended, 1);
  assert.equal(r.speaking, false);
  r.speak('Hello', 'en');
  r.stop();
  assert.equal(cancelled >= 1, true);
  assert.equal(r.speaking, false);
  assert.equal(createReader({ win: {} }).supported, false);
  assert.equal(createReader({ win: {} }).speak('x', 'en'), false);
});
