// QA r1 L-12 (coop#10): on the iPhone, near the cow barn after a long press, four name tags piled on top of each other
// (one hidden behind another with its letters sticking out). render/name-tags.js now runs a screen-space pass after it
// picks the tags: a tag that would overlap one below it on screen moves up just above it; one pushed more than
// NAME_TAGS.stack rows off its animal is left out. Tags that do not touch keep their places. Still no allocation per
// frame and well inside D4's 0.5 ms (24 tags: at most 24 x 24 rectangle checks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFxDom } from './helpers/life-feel.js';

installFxDom({ width: 390, height: 844 });
globalThis.matchMedia = (q) => ({ matches: /max-width: 1180px/.test(q) });       // a phone
const { createNameTags, NAME_TAGS } = await import('../public/js/render/name-tags.js');
const { makeFarm, T0 } = await import('./helpers.js');
// a tag's height on screen (15 px bold at line-height 1.1, plus its outline) and how many rows it may climb
const H = NAME_TAGS.h ?? 18;
const STACK = NAME_TAGS.stack ?? 3;

/** Every visible tag's box on screen: { name, l, r, t, b, x, y } (the tag stands on (x, y), centred, `half` each side). */
function boxes(names) {
  const layer = globalThis.document.getElementById('name-tags');
  return layer.children.filter((c) => c.style.visibility === 'visible' && names.includes(c.textContent)).map((c) => {
    const [, x, y] = /translate3d\((-?\d+)px,(-?\d+)px/.exec(c.style.transform).map(Number);
    const half = Math.ceil(c.textContent.length * 4.8) + 4;
    return { name: c.textContent, x, y, l: x - half, r: x + half, t: y - H, b: y };
  });
}
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

function herd(names, at) {
  const s = makeFarm();
  s.farm.names = {};
  const list = [];
  names.forEach((name, i) => {
    const id = `cow.${i}`;
    s.farm.objects[id] = { def: 'cow', home: 'barn1' };
    s.farm.names[id] = { name, by: 'p2', at: T0 };
    list.push({ id, home: 'barn1', ...at(i) });
  });
  const tags = createNameTags({ toScreenM: (x, z) => ({ x, y: z, visible: true }) });
  tags.setNames(s);
  tags.open('barn1');
  return { tags, list };
}

test('L-12: four tags whose animals stand a few pixels apart never overlap on screen; each stays near its animal', () => {
  const names = ['Bella-Cow', 'Buttercup Moo', 'Daisy Meadow', 'Clover Hill'];
  // the phone shot: heads within ~12 px of each other round the barn door
  const { tags, list } = herd(names, (i) => ({ x: 200 + (i % 2) * 12, z: 400 - i * 6, y: 1.6 }));
  const n = tags.frame(list, { dist: 30 });
  const b = boxes(names);
  assert.equal(b.length, n);
  assert.ok(n >= 3, `most of them still show (${n})`);
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) assert.ok(!overlap(b[i], b[j]), `${b[i].name} / ${b[j].name}`);
  for (const box of b) {
    const a = list[names.indexOf(box.name)];
    assert.ok(Math.round(a.z) - box.y <= STACK * H, `${box.name} at most ${STACK} rows above its animal`);
  }
});

test('L-12: tags that do not touch keep their exact places (no needless nudging)', () => {
  const names = ['Left One', 'Right One'];
  const { tags, list } = herd(names, (i) => ({ x: 80 + i * 200, z: 300, y: 1.6 }));
  assert.equal(tags.frame(list, { dist: 30 }), 2);
  const b = boxes(names);
  assert.deepEqual(b.map((x) => [x.x, x.y]), [[80, 300], [280, 300]]);
});
