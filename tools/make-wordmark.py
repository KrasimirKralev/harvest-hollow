"""Outline the two Meadow Picnic title treatments using the game's bundled OFL font."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

assets = Path(__file__).resolve().parents[1] / 'public/assets'
font = instantiateVariableFont(TTFont(assets / 'fonts/fredoka-latin.woff2'), {'wght': 680})
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
brand = 'MNKISWAN Meadow Picnic'


def line(words, center, baseline, width, fill, rim):
    letters = [glyphs[cmap[ord(char)]] for char in words]
    scale = width / sum(g.width for g in letters)
    x = center - width / 2
    pen = SVGPathPen(glyphs, ntos=lambda n: f'{n:.2f}')
    for glyph in letters:
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        x += glyph.width * scale
    path = pen.getCommands()
    return (f'<path d="{path}" stroke="#653522" stroke-width="{rim + 12}" fill="none"/>'
            f'<path d="{path}" fill="{fill}" stroke="#fff6df" stroke-width="{rim}" paint-order="stroke"/>')

for filename, w, h, main_width, y1, y2 in [
    ('wordmark', 1200, 538, 1120, 183, 477), ('wordmark-wide', 1400, 336, 1270, 90, 290)
]:
    logo = line('MNKISWAN', w / 2, y1, main_width * .42, '#a73343', 10)
    logo += line('Meadow Picnic', w / 2, y2, main_width, '#315343', 15)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
           f'role="img" aria-label="{brand}" stroke-linejoin="round"><title>{brand}</title>{logo}</svg>')
    (assets / f'art/{filename}.svg').write_text(svg + '\n')
