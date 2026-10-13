# The "Harness Hollow" wordmark, carved from wood like the old logo: the bundled Fredoka (public/assets/fonts,
# SIL OFL) at weight 700 turned into outlines, so the SVGs need no font and no external image service.
#
# Writes public/assets/art/wordmark.svg (stacked, 1200 x 538: HARNESS / HOLLOW) and wordmark-wide.svg (one line,
# 1400 x 336: Harness Hollow), the same sizes as the old logo.png / logo-wide.png, so every page keeps its layout.
# tools/make-wordmark.mjs then renders them into those PNG/WebP files (and the landing and home-screen sizes).
#
#   python3 -m venv .scratch/venv && .scratch/venv/bin/pip install fonttools brotli uharfbuzz
#   .scratch/venv/bin/python tools/make-wordmark.py
#
# Deterministic: the grain, the bounce and the tilt come from fixed seeds, so a re-run writes the same bytes.
import io
import math
import os
import random

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONT = os.path.join(ROOT, 'public', 'assets', 'fonts', 'fredoka-latin.woff2')
OUT = os.path.join(ROOT, 'public', 'assets', 'art')
WEIGHT = 700

# the old logo's palette (sampled from logo.png): dark walnut outline, honey wood, cream bevel
INK = '#47230E'
DROP = '#2E1607'
RIM = '#B0672C'
GRAIN = '#B87236'
GRAIN_LIGHT = '#FBE3B4'
BEVEL = '#FFF5DE'
SHADE = '#97501F'


def load_font():
  var = TTFont(FONT)
  var.flavor = None
  buf = io.BytesIO()
  var.save(buf)
  ttf = buf.getvalue()
  static = instantiateVariableFont(TTFont(io.BytesIO(ttf)), {'wght': WEIGHT})
  face = hb.Face(ttf)
  font = hb.Font(face)
  font.set_variations({'wght': WEIGHT})
  return static, font


STATIC, HB = load_font()
GLYPHS = STATIC.getGlyphSet()
ORDER = STATIC.getGlyphOrder()


def shape(text):
  buf = hb.Buffer()
  buf.add_str(text)
  buf.guess_segment_properties()
  hb.shape(HB, buf, {'kern': True})
  return [(ORDER[i.codepoint], p.x_advance) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def f(n):
  s = f'{n:.1f}'
  return s[:-2] if s.endswith('.0') else s


def glyph_path(name, t):
  pen = SVGPathPen(GLYPHS, ntos=f)
  GLYPHS[name].draw(TransformPen(pen, t))
  return pen.getCommands()


def glyph_bounds(name, t):
  pen = BoundsPen(GLYPHS)
  GLYPHS[name].draw(TransformPen(pen, t))
  return pen.bounds


def letters(text, x0, baseline, size, squeeze, track, space, seed, tilt=3.2, bounce=5.0):
  """Lay one line out: [{ ch, d, box, t, cx, cy, angle }], each letter tilted and bounced a little, like hand-cut wood."""
  rnd = random.Random(seed)
  s = size / 1000
  out = []
  x = x0
  for ch, (name, adv) in zip(text, shape(text)):
    if ch == ' ':
      x += space * s * squeeze
      continue
    w = adv * s * squeeze
    angle = rnd.uniform(-tilt, tilt)
    dy = rnd.uniform(-bounce, bounce)
    cx, cy = x + w / 2, baseline - 350 * s
    # font units (y up) -> page px (y down), squeezed, then tilted about the letter's middle
    t = Transform().translate(cx, cy + dy).rotate(math.radians(angle)).translate(-w / 2, 350 * s).scale(s * squeeze, -s)
    out.append({'ch': ch, 'd': glyph_path(name, t), 'box': glyph_bounds(name, t), 't': t, 'cx': cx, 'cy': cy + dy,
                'angle': angle, 'w': w, 'h': 700 * s})
    x += w + track
  return out


def line_width(text, size, squeeze, track, space):
  s = size / 1000
  w = 0
  for ch, (_, adv) in zip(text, shape(text)):
    w += space * s * squeeze if ch == ' ' else adv * s * squeeze + track
  return w - track


def grain(L, rnd, step):
  """Wavy grain lines along the letter (vertical in its own frame), plus a knot on some letters."""
  x0, y0, x1, y1 = L['box']
  pad = 30
  lines = []
  a = math.radians(L['angle'])
  ca, sa = math.cos(a), math.sin(a)
  cx, cy = L['cx'], L['cy']

  def rot(px, py):
    dx, dy = px - cx, py - cy
    return cx + dx * ca - dy * sa, cy + dx * sa + dy * ca

  x = x0 - pad + rnd.uniform(0, step)
  while x < x1 + pad:
    amp = rnd.uniform(2.5, 6.5)
    per = rnd.uniform(60, 110)
    ph = rnd.uniform(0, math.tau)
    pts = []
    y = y0 - pad
    while y <= y1 + pad:
      pts.append(rot(x + amp * math.sin(ph + y / per * math.tau), y))
      y += 10
    d = 'M' + ' L'.join(f'{f(px)} {f(py)}' for px, py in pts)
    lines.append((d, rnd.random() < 0.28))
    x += step * rnd.uniform(0.75, 1.3)
  knot = None
  if rnd.random() < 0.45:
    kx, ky = rnd.uniform(x0 + 0.25 * (x1 - x0), x1 - 0.25 * (x1 - x0)), rnd.uniform(y0 + 0.3 * (y1 - y0), y1 - 0.25 * (y1 - y0))
    knot = (kx, ky, rnd.uniform(5, 8))
  return lines, knot


def carve(Ls, uid, stroke, depth, seed, grain_step):
  """The wooden letters: a dark drop below every letter, then each letter as a piece of its own (outline, rim, honey
  face, grain, cream bevel top-left, shade bottom-right), so neighbours that touch stay two pieces of wood."""
  rnd = random.Random(seed)
  defs = []
  body = []
  for i, L in enumerate(Ls):
    defs.append(f'<path id="{uid}{i}" d="{L["d"]}"/>')
  # the drop: the whole word once, so it reads as one shadow on the ground
  drop = ''.join(f'<use href="#{uid}{i}"/>' for i in range(len(Ls)))
  body.append(f'<g fill="{DROP}" stroke="{DROP}" stroke-width="{f(stroke)}" stroke-linejoin="round" transform="translate(0 {f(depth)})">{drop}</g>')
  bev = stroke * 0.3
  for i, L in enumerate(Ls):
    g = f'{uid}{i}'
    x0, y0, x1, y1 = L['box']
    m = 40
    region = f'x="{f(x0 - m)}" y="{f(y0 - m)}" width="{f(x1 - x0 + 2 * m)}" height="{f(y1 - y0 + 2 * m)}"'
    defs.append(f'<clipPath id="c{g}"><use href="#{g}"/></clipPath>')
    defs.append(f'<mask id="h{g}" maskUnits="userSpaceOnUse" {region}><use href="#{g}" fill="#fff"/>'
                f'<use href="#{g}" fill="#000" transform="translate({f(bev * 0.7)} {f(bev)})"/></mask>')
    defs.append(f'<mask id="s{g}" maskUnits="userSpaceOnUse" {region}><use href="#{g}" fill="#fff"/>'
                f'<use href="#{g}" fill="#000" transform="translate({f(-bev * 0.6)} {f(-bev * 0.9)})"/></mask>')
    defs.append(f'<linearGradient id="w{g}" gradientUnits="userSpaceOnUse" x1="0" y1="{f(y0)}" x2="0" y2="{f(y1)}">'
                f'<stop offset="0" stop-color="#F9DCA4"/><stop offset=".55" stop-color="#EDB977"/>'
                f'<stop offset="1" stop-color="#DC9852"/></linearGradient>')
    lines, knot = grain(L, rnd, grain_step)
    parts = [
      f'<use href="#{g}" fill="{INK}" stroke="{INK}" stroke-width="{f(stroke)}" stroke-linejoin="round"/>',
      f'<use href="#{g}" fill="{RIM}" stroke="{RIM}" stroke-width="{f(stroke * 0.22)}" stroke-linejoin="round"/>',
      f'<use href="#{g}" fill="url(#w{g})"/>',
    ]
    gl = ''.join(f'<path d="{d}" stroke="{GRAIN_LIGHT if light else GRAIN}" stroke-width="{f(2.4 if light else 2.8)}" '
                 f'opacity="{".55" if light else ".5"}"/>' for d, light in lines)
    if knot:
      kx, ky, r = knot
      gl += (f'<ellipse cx="{f(kx)}" cy="{f(ky)}" rx="{f(r * 0.75)}" ry="{f(r * 1.6)}" stroke="{GRAIN}" stroke-width="2.8" opacity=".7"/>'
             f'<ellipse cx="{f(kx)}" cy="{f(ky)}" rx="{f(r * 1.6)}" ry="{f(r * 2.9)}" stroke="{GRAIN}" stroke-width="2.2" opacity=".45"/>')
    parts.append(f'<g clip-path="url(#c{g})" fill="none" stroke-linecap="round">{gl}</g>')
    parts.append(f'<use href="#{g}" fill="{SHADE}" opacity=".5" mask="url(#s{g})"/>')
    parts.append(f'<use href="#{g}" fill="{BEVEL}" opacity=".85" mask="url(#h{g})"/>')
    body.append(''.join(parts))
  return defs, body


# ---- the garden bits: leaves, curly sprouts, the wheat sheaf, the apple, the helper's sparkle -------------------------

LEAF_GRAD = ('<linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A6DD5E"/>'
             '<stop offset="1" stop-color="#4E9A2C"/></linearGradient>')
STEM_INK = '#2C4710'


def leaf(x, y, length, angle, k=1.0):
  L = length
  w = 0.36 * k
  d = (f'M0 0C{f(L * .28)} {f(-L * w)} {f(L * .74)} {f(-L * w * .92)} {f(L)} 0'
       f'C{f(L * .74)} {f(L * w * .8)} {f(L * .28)} {f(L * w * .9)} 0 0Z')
  rib = f'M{f(L * .1)} 0Q{f(L * .5)} {f(-L * .05)} {f(L * .86)} {f(-L * .01)}'
  shine = f'M{f(L * .24)} {f(-L * w * .45)}Q{f(L * .5)} {f(-L * w * .72)} {f(L * .72)} {f(-L * w * .42)}'
  sw = max(3.2, L * 0.065)
  return (f'<g transform="translate({f(x)} {f(y)}) rotate({f(angle)})">'
          f'<path d="{d}" fill="url(#leaf)" stroke="{STEM_INK}" stroke-width="{f(sw)}" stroke-linejoin="round"/>'
          f'<path d="{rib}" fill="none" stroke="#3A6E1A" stroke-width="{f(sw * .6)}" stroke-linecap="round" opacity=".85"/>'
          f'<path d="{shine}" fill="none" stroke="#E4F7B8" stroke-width="{f(sw * .55)}" stroke-linecap="round" opacity=".7"/></g>')


def stem(d, width):
  return (f'<path d="{d}" fill="none" stroke="{STEM_INK}" stroke-width="{f(width + 5.5)}" stroke-linecap="round" stroke-linejoin="round"/>'
          f'<path d="{d}" fill="none" stroke="#6CB53A" stroke-width="{f(width)}" stroke-linecap="round" stroke-linejoin="round"/>')


def curl(x, y, r, flip=1):
  """A tendril that rises from (x, y) and rolls into a little spiral (flip -1 rolls the other way)."""
  q = flip
  d = (f'M{f(x)} {f(y)}C{f(x + q * r * .1)} {f(y - r * 1.2)} {f(x + q * r * 1.5)} {f(y - r * 2.3)} {f(x + q * r * 1.2)} {f(y - r * 3.0)}'
       f'C{f(x + q * r * .9)} {f(y - r * 3.6)} {f(x + q * r * .1)} {f(y - r * 3.4)} {f(x + q * r * .3)} {f(y - r * 2.85)}'
       f'C{f(x + q * r * .45)} {f(y - r * 2.5)} {f(x + q * r * .9)} {f(y - r * 2.75)} {f(x + q * r * .78)} {f(y - r * 3.0)}')
  return stem(d, max(4.5, r * 0.32))


def sprout(x, y, h, lean=0, leaves=2, size=1.0):
  """A seedling on top of a letter: a short stem and two leaves."""
  tx, ty = x + lean, y - h
  d = f'M{f(x)} {f(y)}Q{f(x + lean * .2)} {f(y - h * .6)} {f(tx)} {f(ty)}'
  out = stem(d, 5.5 * size)
  if leaves >= 1:
    out += leaf(tx, ty, 52 * size, -150 + lean * .4, 1.0)
  if leaves >= 2:
    out += leaf(tx, ty, 58 * size, -28 + lean * .4, 1.0)
  return out


def wheat(x, y, scale, rnd, tilt=-14):
  """A tied sheaf: stalks fanning out above and below a red band, golden ears on top, leaning a little."""
  s = scale
  stalks = []
  ears = []
  for k in range(-3, 4):
    a = math.radians(k * 12 + rnd.uniform(-2.5, 2.5))
    reach = (150 - abs(k) * 9) * s
    top = (x + math.sin(a) * reach, y - math.cos(a) * reach)
    bot = (x - math.sin(a) * 34 * s, y + 92 * s)
    stalks.append(f'M{f(bot[0])} {f(bot[1])}L{f(x + math.sin(a) * 4 * s)} {f(y)}L{f(top[0])} {f(top[1])}')
    # the ear: kernels in two rows along the stalk's top, pointing up and out
    for j in range(5):
      t = 0.6 + j * 0.08
      ex, ey = x + math.sin(a) * reach * t, y - math.cos(a) * reach * t
      for side in (-1, 1):
        ang = math.degrees(a) + side * 30
        ears.append(f'<ellipse cx="0" cy="0" rx="{f(6 * s)}" ry="{f(11.5 * s)}" transform="translate({f(ex + side * 5.5 * s * math.cos(a))} '
                    f'{f(ey + side * 5.5 * s * math.sin(a))}) rotate({f(ang)})"/>')
    tip = (x + math.sin(a) * (reach + 16 * s), y - math.cos(a) * (reach + 16 * s))
    ears.append(f'<ellipse cx="0" cy="0" rx="{f(5 * s)}" ry="{f(10 * s)}" transform="translate({f(tip[0])} {f(tip[1])}) rotate({f(math.degrees(a))})"/>')
  sd = ''.join(stalks)
  band = (f'<path d="M{f(x - 24 * s)} {f(y - 6 * s)}Q{f(x)} {f(y + 4 * s)} {f(x + 24 * s)} {f(y - 6 * s)}L{f(x + 24 * s)} {f(y + 12 * s)}'
          f'Q{f(x)} {f(y + 22 * s)} {f(x - 24 * s)} {f(y + 12 * s)}Z" fill="#D8412F" stroke="{INK}" stroke-width="{f(4 * s)}" stroke-linejoin="round"/>'
          f'<path d="M{f(x - 16 * s)} {f(y + 2 * s)}Q{f(x)} {f(y + 9 * s)} {f(x + 16 * s)} {f(y + 2 * s)}" fill="none" stroke="#F58A6E" '
          f'stroke-width="{f(3 * s)}" stroke-linecap="round"/>')
  return (f'<g stroke-linecap="round" stroke-linejoin="round" transform="rotate({f(tilt)} {f(x)} {f(y)})">'
          f'<path d="{sd}" fill="none" stroke="#7A4A16" stroke-width="{f(9 * s)}"/>'
          f'<path d="{sd}" fill="none" stroke="#E6B852" stroke-width="{f(4.5 * s)}"/>'
          f'<g fill="#F3C65A" stroke="#8A5617" stroke-width="{f(2.6 * s)}">{"".join(ears)}</g>{band}</g>')


def apple(x, y, r):
  body = (f'M{f(x)} {f(y - r * .72)}C{f(x + r * .55)} {f(y - r * 1.05)} {f(x + r * 1.08)} {f(y - r * .62)} {f(x + r * 1.0)} {f(y + r * .02)}'
          f'C{f(x + r * .95)} {f(y + r * .7)} {f(x + r * .45)} {f(y + r * 1.05)} {f(x)} {f(y + r * .9)}'
          f'C{f(x - r * .45)} {f(y + r * 1.05)} {f(x - r * .95)} {f(y + r * .7)} {f(x - r * 1.0)} {f(y + r * .02)}'
          f'C{f(x - r * 1.08)} {f(y - r * .62)} {f(x - r * .55)} {f(y - r * 1.05)} {f(x)} {f(y - r * .72)}Z')
  return (f'<path d="M{f(x)} {f(y - r * .62)}Q{f(x - r * .05)} {f(y - r * 1.05)} {f(x + r * .22)} {f(y - r * 1.3)}" fill="none" '
          f'stroke="{INK}" stroke-width="{f(r * .26)}" stroke-linecap="round"/>'
          f'<path d="M{f(x)} {f(y - r * .62)}Q{f(x - r * .05)} {f(y - r * 1.05)} {f(x + r * .22)} {f(y - r * 1.3)}" fill="none" '
          f'stroke="#8A5A2B" stroke-width="{f(r * .12)}" stroke-linecap="round"/>'
          f'<path d="{body}" fill="url(#apple)" stroke="{INK}" stroke-width="{f(max(4.5, r * .1))}" stroke-linejoin="round"/>'
          f'<ellipse cx="{f(x - r * .45)}" cy="{f(y - r * .25)}" rx="{f(r * .17)}" ry="{f(r * .3)}" fill="#FFF" opacity=".75" '
          f'transform="rotate(24 {f(x - r * .45)} {f(y - r * .25)})"/>'
          + leaf(x + r * .12, y - r * 1.05, r * .95, -24))


APPLE_GRAD = ('<radialGradient id="apple" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#FF7A62"/>'
              '<stop offset=".45" stop-color="#E02C22"/><stop offset="1" stop-color="#99120F"/></radialGradient>')


def sparkle(x, y, r):
  d = (f'M{f(x)} {f(y - r)}Q{f(x + r * .16)} {f(y - r * .16)} {f(x + r)} {f(y)}Q{f(x + r * .16)} {f(y + r * .16)} {f(x)} {f(y + r)}'
       f'Q{f(x - r * .16)} {f(y + r * .16)} {f(x - r)} {f(y)}Q{f(x - r * .16)} {f(y - r * .16)} {f(x)} {f(y - r)}Z')
  return f'<path d="{d}" fill="#FFE27A" stroke="{INK}" stroke-width="{f(max(3, r * .13))}" stroke-linejoin="round"/>'


def svg(w, h, title, defs, body):
  return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">'
          f'<title>{title}</title><defs>{LEAF_GRAD}{APPLE_GRAD}{"".join(defs)}</defs>{"".join(body)}</svg>\n')


def top_of(L, at=0.5):
  """A point on the letter's top edge, `at` across its box (a sprout's foot)."""
  x0, y0, x1, y1 = L['box']
  return x0 + (x1 - x0) * at, y0 + 6


def fit(text, width, squeeze, track, space):
  """The font size that makes the line `width` px wide."""
  k = line_width(text, 1000, squeeze, 0, space) / 1000
  return (width - track * (len(text.replace(' ', '')) - 1)) / k


def stacked():
  W, H = 1200, 538
  squeeze, track = 0.86, 8
  size = fit('HARNESS', 940, squeeze, track, 0)
  w1 = line_width('HARNESS', size, squeeze, track, 0)
  w2 = line_width('HOLLOW', size, squeeze, track, 0)
  mid = 636
  l1 = letters('HARNESS', mid - w1 / 2, 258, size, squeeze, track, 0, seed=11)
  l2 = letters('HOLLOW', mid - w2 / 2 - 6, 468, size, squeeze, track, 0, seed=23)
  rnd = random.Random(5)
  d1, b1 = carve(l1, 'a', 28, 12, 101, 18)
  d2, b2 = carve(l2, 'b', 28, 12, 202, 18)
  back = [
    curl(*top_of(l1[2], 0.3), 22, -1),
    sprout(*top_of(l1[5], 0.5), 40, lean=6, size=1.0),
    leaf(l1[6]['box'][2] - 10, 168, 62, -16),
    leaf(l1[0]['box'][0] + 26, 108, 56, -150),
    curl(l2[0]['box'][0] + 20, 440, 24, -1),
    leaf(l2[3]['box'][0] + 40, l2[3]['box'][1] + 4, 48, -60),
  ]
  front = [
    leaf(l1[3]['box'][0] + 30, l1[3]['box'][1] + 6, 50, -124),
    wheat(l1[0]['box'][0] - 34, 292, 0.95, rnd),
    apple(l2[-1]['box'][2] + 34, 452, 56),
    sparkle(l2[-1]['box'][2] + 66, 330, 24),
    sparkle(l2[-1]['box'][2] + 30, 300, 13),
  ]
  return svg(W, H, 'Harness Hollow', d1 + d2, back + b1 + b2 + front)


def wide():
  W, H = 1400, 336
  squeeze, track, space = 0.79, 5, 130
  text = 'Harness Hollow'
  size = fit(text, 1096, squeeze, track, space)
  Ls = letters(text, 166, 240, size, squeeze, track, space, seed=31, tilt=2.6, bounce=4)
  rnd = random.Random(9)
  d, b = carve(Ls, 'w', 24, 10, 303, 15)
  back = [
    curl(*top_of(Ls[0], 0.8), 22, 1),
    leaf(Ls[3]['box'][0] + 26, Ls[3]['box'][1] + 6, 44, -128),
    sprout(*top_of(Ls[6], 0.45), 30, lean=-3, size=0.82),
    curl(*top_of(Ls[10], 0.55), 20, -1),
    leaf(Ls[11]['box'][2] - 12, Ls[11]['box'][1] + 8, 40, -48),
  ]
  front = [
    wheat(Ls[0]['box'][0] - 40, 214, 0.74, rnd),
    apple(Ls[-1]['box'][2] + 14, 238, 48),
    sparkle(Ls[-1]['box'][2] + 44, 118, 22),
    sparkle(Ls[-1]['box'][2] + 4, 92, 12),
  ]
  return svg(W, H, 'Harness Hollow', d, back + b + front)


if __name__ == '__main__':
  for name, make in (('wordmark.svg', stacked), ('wordmark-wide.svg', wide)):
    data = make()
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
      fh.write(data)
    print(name, len(data.encode()), 'bytes')
