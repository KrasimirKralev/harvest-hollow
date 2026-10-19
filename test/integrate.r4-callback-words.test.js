// QA r4 A4-01 (hv#6, page half; H8 "Harvey / Харви on the farmer's own helper everywhere"): after a sign-in, the page
// the provider sends the farmer to (public/harness-callback.html, served by server/agent/routes.js sendCallbackPage for
// the mock and for ChatGPT's /auth/callback) said "Your helper can work with your account now" / „Помощникът ти вече
// може да работи с профила ти“, while the in-game sign-in tab says Harvey and "your own plan" / „твоя собствен план“.
// The page is static HTML, outside tools/i18n-scan.mjs (it walks public/js only), so this test reads its words.
// A word check, not the exact sentences, so a later copy pass can reword freely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'harness-callback.html');
const html = fs.readFileSync(PAGE, 'utf8');

/** One language card's markup: from its `data-lang` section to the closing tag. */
function card(lang) {
  const m = new RegExp(`<section[^>]*data-lang="${lang}"[^>]*>([\\s\\S]*?)</section>`).exec(html);
  assert.ok(m, `the page has a ${lang} card`);
  return m[1];
}

/** The text of every element the success page shows only on "ok" (class when-ok), tags stripped. */
function okLines(lang) {
  return [...card(lang).matchAll(/<(\w+)[^>]*class="[^"]*\bwhen-ok\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => m[2].replace(/<[^>]+>/g, '').trim());
}

test('A4-01: the signed-in page calls the helper Harvey and the account the farmer\'s plan (EN)', () => {
  const lines = okLines('en');
  assert.ok(lines.length >= 2, `EN when-ok lines: ${JSON.stringify(lines)}`);
  const text = lines.join(' | ');
  assert.doesNotMatch(text, /helper/i, text);
  assert.match(text, /\bHarvey\b/, text);
  assert.match(text, /\bplan\b/, text);
});

test('A4-01: the signed-in page calls the helper Харви and the account the farmer\'s план (BG)', () => {
  const lines = okLines('bg');
  assert.ok(lines.length >= 2, `BG when-ok lines: ${JSON.stringify(lines)}`);
  const text = lines.join(' | ');
  assert.doesNotMatch(text, /помощник/i, text);
  assert.match(text, /Харви/, text);
  assert.match(text, /план/, text);
});

test('A4-01: the BG card says план like the game\'s sign-in tab and harness.err.DENIED, never абонамент', () => {
  const words = card('bg').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(words, /абонамент/i, words.replace(/\s+/g, ' ').trim());
});
