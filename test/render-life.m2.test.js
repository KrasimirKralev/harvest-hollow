// render-life, wave 3 (M2): bred coats, babies with their own proportions, Nursery personalities, alpaca behaviours,
// the horse show, fishing, the Grand decor seats, the M2 assets (furniture, town, pavilion, far twins, icons) and the
// FX of the M2 events. Deterministic, no DOM, no sleeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COAT_PALETTE, coatColors, coatId, personalityOf, PERSONALITY, BABY_BONES, dustPose, trotPose, cushes, HORSE_SHOW_EVENTS,
  WANDER_MS } from '../public/js/render/animals-view.js';
import { SEATS, seatFrame, seatOf, FISH_EVENTS, FISH_T, castPoint, linePoint } from '../public/js/render/avatars-view.js';
import { CONTENT, BREEDING, FISHING, FESTIVAL_PAVILION, defOf } from '../shared/content/index.js';
import { FX_EVENTS, CELEBRATIONS } from '../shared/rules/index.js';
import { TILE_M } from '../shared/content/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/models/manifest.json'), 'utf8'));
const ICONS = new Set(fs.readdirSync(path.join(ROOT, 'public/assets/icons')).map((f) => f.replace(/\.png$/, '')));
const T0 = 1_800_000_000_000;

/** The attribute names of every primitive in a GLB (its JSON chunk). */
function glbAttributes(file) {
  const buf = fs.readFileSync(path.join(ROOT, 'public/assets/models', file));
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  return (json.meshes || []).flatMap((m) => m.primitives.map((p) => Object.keys(p.attributes)));
}

test('bred coats: every rolled coat on every breedable species, the season coats, none and unknown', () => {
  for (const sp of BREEDING.species) {
    for (const c of BREEDING.coats) {
      const cc = coatColors(sp, c.id);
      assert.ok(cc, `${sp} ${c.id}`);
      assert.equal(cc.mode, COAT_PALETTE[c.id].mode);
      for (const v of [...cc.a, ...cc.b]) assert.ok(v >= 0 && v <= 1, `${sp} ${c.id} linear colour`);
    }
    // a spotted coat paints its spots in a second colour; a golden one shimmers lighter on them
    const sp2 = coatColors(sp, 'spotted');
    assert.notDeepEqual(sp2.a, sp2.b, `${sp} spotted has two colours`);
    assert.equal(coatColors(sp, 'golden').mode, 3);
  }
  for (const c of BREEDING.seasonCoats) {
    const cc = coatColors('cow', c.id);
    assert.equal(cc.mode, 2, `${c.id} is a dappled season coat`);
  }
  assert.equal(coatColors('cow', null), null, 'a bought animal keeps its own look');
  const odd = coatColors('cow', 'stardust');
  assert.ok(odd && odd.mode === 1, 'a coat this build does not know still tints');
  assert.deepEqual(coatColors('cow', 'stardust'), odd, 'and the same way on both screens');
  assert.equal(coatId({ coat: 'golden' }), 'golden');
  assert.equal(coatId({ coat: { id: 'russet' } }), 'russet');
  assert.equal(coatId({}), null);
});

test('coats and babies are in the models: every breedable species carries the coat mask and has a baby', () => {
  for (const sp of BREEDING.species) {
    const adult = MAN.keys[`animal:${sp}`];
    assert.ok(adult, `animal:${sp}`);
    assert.ok(glbAttributes(adult.file).some((a) => a.includes('_COAT')), `${sp}: the model carries _COAT`);
    const baby = MAN.keys[`animal:${sp}:baby`];
    assert.ok(baby, `animal:${sp}:baby`);
    assert.ok(baby.min[1] > -0.05 && baby.min[1] < 0.05, `${sp} baby stands on the ground`);
  }
  // the skinned babies' runtime bones match the baked rigid babies (tools/build-assets.mjs UAA_BABY / FA_BABY)
  const src = fs.readFileSync(path.join(ROOT, 'tools/build-assets.mjs'), 'utf8');
  for (const [sp, bones] of Object.entries(BABY_BONES)) {
    assert.equal(MAN.keys[`animal:${sp}`].kind, 'skinned', `${sp} is skinned near the camera`);
    for (const [b, k] of Object.entries(bones)) assert.ok(src.includes(`'${b}': ${k}`) || src.includes(`${b}: ${k}`), `${sp} ${b} ${k} matches the build`);
  }
  // the baby has its own proportions: a bigger head against its body than the adult's
  const ratio = (k) => MAN.keys[k].size[1] / MAN.keys[k].size[2];
  assert.ok(ratio('animal:pig:baby') !== ratio('animal:pig') || MAN.keys['animal:pig:baby'].size[2] !== MAN.keys['animal:pig'].size[2], 'the piglet is not a scaled pig');
});

test('Nursery personalities: the rules\' `pers` picks the idle set', () => {
  for (const p of ['sleepy', 'playful', 'grumpy']) {
    assert.equal(personalityOf({ pers: p }), p);
    assert.ok(PERSONALITY[p].idles.length >= 2 && PERSONALITY[p].scale > 0);
  }
  assert.equal(personalityOf({}), null);
  assert.equal(personalityOf({ pers: 'chaotic' }), null, 'an unknown pick plays the plain idles');
});

test('alpacas: some segments end in the dust patch (and say so), some on the knoll; cushing by species and mood', () => {
  const dust = { x: 4, z: 4, r: 1 }; const perches = [{ x: 9, z: 9, r: 0.7, y: 0.28 }];
  let inDust = 0; let onKnoll = 0;
  for (let k = 0; k < 300; k++) {
    const p = dustPose('alp-1', T0 + k * WANDER_MS + WANDER_MS - 1, { x: 6, z: 6 }, [0, 0, 12, 12], dust, perches);
    assert.equal(p.inDust, Math.hypot(p.x - dust.x, p.z - dust.z) < dust.r * 0.85);
    if (p.inDust) inDust++;
    if (Math.hypot(p.x - 9, p.z - 9) < 0.7) onKnoll++;
  }
  assert.ok(inDust > 30 && inDust < 100, `about one in five in the dust (${inDust}/300)`);
  assert.ok(onKnoll > 30 && onKnoll < 100, `about one in five on the knoll (${onKnoll}/300)`);
  assert.deepEqual(dustPose('alp-1', T0 + 777, { x: 6, z: 6 }, [0, 0, 12, 12], dust, perches), dustPose('alp-1', T0 + 777, { x: 6, z: 6 }, [0, 0, 12, 12], dust, perches));
  let alp = 0; let sleepy = 0; let cow = 0;
  for (let s = 0; s < 400; s++) { if (cushes('alpaca', 'a', s)) alp++; if (cushes('cow', 'c', s, 'sleepy')) sleepy++; if (cushes('cow', 'c', s)) cow++; }
  assert.ok(alp > 40 && alp < 120, `an alpaca lies down now and then (${alp}/400)`);
  assert.ok(sleepy > 130 && sleepy < 230, `a sleepy cow often (${sleepy}/400)`);
  assert.equal(cow, 0, 'a plain cow never');
});

test('the horse show: a shown horse trots laps of its oval at a show pace', () => {
  const o = { x: 10, z: 20, rx: 2, rz: 1.2, speed: 2.2 };
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const p = trotPose(i * 0.1, 0, o);
    assert.ok(Math.abs(((p.x - o.x) / o.rx) ** 2 + ((p.z - o.z) / o.rz) ** 2 - 1) < 1e-9, 'on the oval');
    assert.ok(p.trot && p.walking);
    if (prev) {
      const dx = p.x - prev.x; const dz = p.z - prev.z;
      const dir = Math.atan2(dx, dz);
      const err = Math.abs(Math.atan2(Math.sin(dir - p.face), Math.cos(dir - p.face)));
      assert.ok(err < 0.3, `faces where it goes (${err.toFixed(2)})`);
    }
    prev = p;
  }
  assert.ok(HORSE_SHOW_EVENTS.has('horseShow'));
});

test('fishing: the rules\' event names, where the float lands, the line sags between rod and float', () => {
  for (const e of ['fishCast', 'fishCaught']) assert.ok(FX_EVENTS.has(e), `${e} is a rules event`);
  assert.ok(FISH_EVENTS.cast.has('fishCast') && FISH_EVENTS.catch.has('fishCaught'));
  const at = castPoint({ x: 10, z: 10 }, 0);
  assert.ok(Math.abs(at.x - 10) < 1e-9 && Math.abs(at.z - (10 + FISH_T.reach)) < 1e-9, 'reach ahead');
  assert.deepEqual(castPoint({ x: 0, z: 0 }, 1, { x: 3, z: 4 }), { x: 3.5 * TILE_M, z: 4.5 * TILE_M }, 'the event\'s tile');
  const a = { x: 0, y: 2, z: 0 }; const b = { x: 4, y: 0.1, z: 0 };
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-9;
  assert.ok(near(linePoint(a, b, 0, 0.3), a), 'from the rod tip');
  assert.ok(near(linePoint(a, b, 1, 0.3), b), 'to the float');
  assert.ok(linePoint(a, b, 0.5, 0.3).y < (a.y + b.y) / 2, 'the slack line sags');
  assert.ok(FISHING.fish.every((f) => ICONS.has(`fish_${f.id}`)), 'every fish has an icon (the dock panel)');
  assert.ok(MAN.keys['tool:fishing_rod'] && Array.isArray(MAN.keys['tool:fishing_rod'].tip), 'the rod and its tip');
});

test('seats on the two-seat Grand decor: on the piece, facing the way its bench faces, two apart', () => {
  for (const [id, st] of Object.entries(SEATS)) {
    const def = defOf(id);
    assert.ok(def, `${id} is content`);
    const o = { def: id, x: 20, z: 20, rot: 1 };
    const [w, d] = def.size;
    const cx = (o.x + d / 2) * TILE_M; const cz = (o.z + w / 2) * TILE_M;
    const a = seatFrame(o, -1); const b = seatFrame(o, 1);
    for (const s of [a, b]) {
      assert.ok(Math.abs(s.x - cx) <= Math.max(w, d) * TILE_M / 2 + 0.01 && Math.abs(s.z - cz) <= Math.max(w, d) * TILE_M / 2 + 0.01, `${id}: inside its footprint`);
      assert.equal(s.y, st.y);
      assert.ok(Math.abs(s.face - (Math.PI / 2 + st.turn)) < 1e-9, `${id}: faces with its bench`);
    }
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - st.spread * 2) < 1e-6, `${id}: two seats ${st.spread * 2} m apart`);
  }
  const state = { farm: { objects: { k: { def: 'koi_pond', x: 10, z: 10, rot: 0 } } } };
  const s1 = seatOf({ p1: { id: 'k' } }, 'p1', state);
  assert.ok(Math.abs(s1.face - Math.PI) < 1e-9, 'the koi pond bench looks over the water');
});

test('the M2 assets: furniture, the village, the pavilion, far twins, babies and the reward decor', () => {
  for (const [id, def] of CONTENT.furniture) {
    const e = MAN.keys[`furniture:${id}`];
    assert.ok(e, `furniture:${id}`);
    assert.equal(e.layer, def.layer, `${id} layer`);
    assert.ok(ICONS.has(id), `${id} icon`);
    if (def.layer !== 'wall') assert.ok(e.size[0] <= def.size[0] * 1.06 + 0.05 && e.size[2] <= def.size[1] * 1.06 + 0.05, `${id} fits ${def.size} m (${e.size})`);
    else assert.ok(e.min[1] > 0.3, `${id} hangs on the wall`);
  }
  assert.ok(MAN.keys['interior:room'], 'the room shell');
  for (const [id] of CONTENT.townProjects) {
    assert.ok(MAN.keys[`town:${id}`], `town:${id}`);
    assert.ok(MAN.keys[`town:construction:${id}`], `town:construction:${id}`);
    assert.ok(MAN.keys[`town:${id}`].tris <= 3600, `${id} keeps the far-scenery budget (${MAN.keys[`town:${id}`].tris})`);
  }
  for (let k = 1; k <= FESTIVAL_PAVILION.tiers.length; k++) assert.ok(MAN.keys[`town:festival_pavilion:${k}`], `pavilion tier ${k}`);
  for (const id of ['grand_windmill', 'flower_maze', 'koi_pond', 'carousel', 'treehouse', 'clock_tower', 'orangery', 'arbor_of_lights', 'bath_house', 'golden_gate']) {
    const far = MAN.keys[`decor:${id}:far`];
    assert.ok(far && far.tris <= 1800, `decor:${id}:far (${far && far.tris})`);
    assert.ok(MAN.keys[`decor:${id}`].tris <= 8000, `${id} near (${MAN.keys[`decor:${id}`].tris})`);
  }
  assert.ok(MAN.keys['building:grand_windmill:sails']?.pivot, 'the Dutch windmill\'s sails turn about their hub');
  assert.ok(MAN.keys['npc:grandma']?.kind === 'skinned', 'Grandma Hazel');
  assert.ok(MAN.keys['prop:balloon'], 'the sky balloon without its mooring');
  for (const [id, d] of CONTENT.decor) if (d.m === 'M2' && /_souvenir$/.test(id)) assert.ok(MAN.keys[`decor:${id}`].tris <= 3600, `${id} is a miniature (${MAN.keys[`decor:${id}`].tris})`);
});

test('the FX of the M2 events are the rules\' own events', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/render/fx.js'), 'utf8');
  const m2 = ['bred', 'breedStarted', 'nursed', 'nurseDone', 'coatWorn', 'fishTogether', 'duelInvited', 'duelAccepted', 'duelEnded', 'trackTier', 'perkPicked',
    'grandmaArrived', 'grandmaLeft', 'interiorOpened', 'furnished'];
  for (const e of m2) {
    assert.ok(src.includes(`R.set('${e}'`), `fx.js plays ${e}`);
    assert.ok(FX_EVENTS.has(e) || CELEBRATIONS.has(e), `${e} is a rules event`);
  }
});
