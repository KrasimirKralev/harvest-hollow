// Farmer portraits in the HUD chips and the slot picker (wave 4b, hud lane; owner 2026-10-05: "Give an icon showing the
// hero farmer person. Some kind of portrait. And make sure the name is displayed correctly."). The drawing itself needs
// WebGL (checked in the browser: .scratch/w4b-hud/); these are the pure parts and the DOM contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installDom } from './ui-qa2-dom.js';

// a localStorage for the portrait cache, before the module first reads it
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const P = await import('../public/js/render/portrait.js');
const { portraitSpec, portraitKey, peekPortrait, lastPortrait, drawPortrait, PORTRAIT } = P;

test('portraitSpec: the rig the farm draws (farmer 2 is B, a chosen build wins), the colour normalized', () => {
  assert.equal(portraitSpec('p1', { color: '#2bb3a3' }).body, 'farmer_a');
  assert.equal(portraitSpec('p2', { color: '#FF7A6B' }).body, 'farmer_b');
  assert.equal(portraitSpec('p3', {}).body, 'farmer_a');
  assert.equal(portraitSpec('p2', { avatar: { body: 'farmer_a' } }).body, 'farmer_a');
  assert.equal(portraitSpec('p1', { color: '#2bb3a3' }).color, '#2BB3A3');
  assert.equal(portraitSpec('p1', { color: 'teal' }).color, '#2BB3A3', 'a bad colour falls back, never throws');
  assert.equal(portraitSpec('p1', null).avatar, null);
});

test('portraitKey: the look, rig and colour only; stable across key order and hex case; never the name or the XP', () => {
  const look = { hat: 'cap', hair: 'curly', hairColor: '#c8473a' };
  const a = portraitKey(portraitSpec('p1', { name: 'Rowan', xp: 10, color: '#2BB3A3', avatar: look }));
  const b = portraitKey(portraitSpec('p1', { name: 'Rowena', xp: 9999, color: '#2bb3a3', avatar: { hairColor: '#C8473A', hair: 'curly', hat: 'cap' } }));
  assert.equal(a, b);
  assert.ok(a.startsWith(`p${PORTRAIT.v}|`), 'the drawing version is in the key: a new drawing replaces every cached one');
  const other = (p) => portraitKey(portraitSpec('p1', { color: '#2BB3A3', avatar: look, ...p }));
  assert.notEqual(other({ color: '#FF7A6B' }), a, 'the colour');
  assert.notEqual(other({ avatar: { ...look, hat: 'beanie' } }), a, 'the hat');
  assert.notEqual(other({ avatar: { ...look, body: 'farmer_b' } }), a, 'the rig');
  assert.notEqual(portraitKey(portraitSpec('p1', { color: '#2BB3A3' })), a, 'no look (the rig\'s own) is a look of its own');
});

test('the cache: a stored portrait is found at once (no draw at boot); lastPortrait finds a farmer by slot and colour', () => {
  const spec = portraitSpec('p2', { color: '#FF7A6B', avatar: { hat: 'cap' } });
  const url = 'data:image/webp;base64,AAAA';
  mem.set('hh.portraits', JSON.stringify({ [portraitKey(spec)]: { u: url, pid: 'p2', c: '#FF7A6B', t: 5 },
    'p0|old|#FFFFFF|': { u: 'data:image/png;base64,OLD', pid: 'p2', c: '#FF7A6B', t: 9 } }));
  assert.equal(peekPortrait(spec), url);
  assert.equal(peekPortrait(portraitSpec('p2', { color: '#FF7A6B' })), null, 'another look is not that picture');
  assert.equal(lastPortrait('p2', '#ff7a6b'), url, 'an entry of an older drawing version is ignored');
  assert.equal(lastPortrait('p1', '#FF7A6B'), null);
});

test('drawPortrait: no WebGL (a lost context) resolves null and the key rests, so a chip never re-asks in a loop', async () => {
  let asked = 0;
  const lost = { getContext: () => { asked++; return { isContextLost: () => true }; } };
  const spec = portraitSpec('p1', { color: '#5DBB3F' });
  const first = drawPortrait(lost, spec);
  assert.equal(drawPortrait(lost, spec), first, 'one request per look while it is on its way');
  assert.equal(await first, null);
  assert.equal(asked, 1);
  assert.equal(await drawPortrait(lost, spec), null);
  assert.equal(asked, 1, 'within PORTRAIT.retryMs the failed key is not drawn again');
});

test('the chip face: the initial until the portrait is decoded; a stale answer never overwrites a newer look', async () => {
  installDom();
  const decoded = [];
  globalThis.Image = class { decode() { decoded.push(this.src); return Promise.resolve(); } };
  const { portraitFace, showPortrait, initialOf } = await import('../public/js/ui/hud.js');
  assert.equal(initialOf('деси'), 'Д');
  assert.equal(initialOf('  émile'), 'É');
  assert.equal(initialOf('😀 Joy'), '😀', 'a whole code point, never half an emoji');
  assert.equal(initialOf(''), '?');
  const face = portraitFace('K');
  assert.equal(face.querySelector('.ltr').textContent, 'K');
  // no view.portrait (the render lane's hook not there, or no WebGL): the initial stays and nothing is pending
  showPortrait(face, portraitSpec('p1', { color: '#4AA8E8' }), {});
  assert.equal(face.classList.contains('has-portrait'), false);
  assert.equal(face.dataset.pk, undefined);
  // a view that answers later: the first look's answer arrives after a second look was asked for
  const answers = [];
  const view = { portrait: (spec) => new Promise((res) => answers.push({ spec, res })) };
  const one = portraitSpec('p1', { color: '#4AA8E8', avatar: { hat: 'cap' } });
  const two = portraitSpec('p1', { color: '#4AA8E8', avatar: { hat: 'beanie' } });
  showPortrait(face, one, view);
  showPortrait(face, one, view);
  assert.equal(answers.length, 1, 'the same look asks once');
  showPortrait(face, two, view);
  answers[0].res('data:image/webp;base64,ONE');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(face.classList.contains('has-portrait'), false, 'the old look\'s picture is dropped');
  answers[1].res('data:image/webp;base64,TWO');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(face.classList.contains('has-portrait'), true);
  assert.equal(face.querySelector('img.pf').src, 'data:image/webp;base64,TWO');
  // a draw that failed: the face forgets the key, so the next players change asks again (after the module's rest)
  const f2 = portraitFace('D');
  showPortrait(f2, portraitSpec('p2', { color: '#9B6BD6' }), { portrait: () => Promise.resolve(null) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f2.dataset.pk, undefined);
  assert.equal(f2.classList.contains('has-portrait'), false);
});

test('the name plate CSS: a fixed-height plate with both lines centred, the name ellipsized beside a "(you)" that stays', () => {
  const css = fs.readFileSync(new URL('../public/css/shell.css', import.meta.url), 'utf8');
  const rule = (sel) => { const i = css.indexOf(`${sel} {`); assert.ok(i >= 0, `${sel} is styled`); return css.slice(i, css.indexOf('}', i)); };
  assert.match(rule('.players .tag'), /height: 42px/);
  assert.match(rule('.players .tag'), /flex-direction: column; justify-content: center/);
  assert.match(rule('.players .who .nm'), /text-overflow: ellipsis/);
  assert.match(rule('.players .who .you'), /flex: none/);
  assert.doesNotMatch(css, /\.who::after \{ content: ' \(you\)'/, '"(you)" is an element now, never cut by the ellipsis');
  assert.match(css, /\.players\.snug li\.partner \.tag \{ display: none; \}/);
});
