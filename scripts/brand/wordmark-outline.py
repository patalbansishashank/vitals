#!/usr/bin/env python3
"""One-off extractor: turns Archivo text into SVG path outlines, so brand renders never depend on installed fonts.
Not run by the generator; rerun it only if the wordmark or the tagline changes. From the repo root:

  mkdir -p .e6-tmp/w2 && cd .e6-tmp/w2 && npm init -y && npm i wawoff2      # temporary tool, not a repo dependency
  node -e "require('wawoff2').decompress(require('fs').readFileSync(
    '../../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')).then(
    b => require('fs').writeFileSync('archivo.ttf', b))"
  cd ../.. && python3 scripts/brand/wordmark-outline.py .e6-tmp/w2/archivo.ttf

Needs fontTools (pip: fonttools). The variable font has wght 100-900 and wdth 62-125. Writes:
  public/brand/wordmark.svg           "vitals", wdth 120, wght 650, letter-spacing -0.02em (as in src/styles/shell.css)
  scripts/brand/tagline-outline.json  the tagline, wdth 100, wght 450, letter-spacing 0 (read by lockup.mjs)
Kerning comes from the font's GPOS "kern" pair lookups (class and glyph pairs).
"""
import json
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
TAGLINE = 'See what a plan does before you live it.'


def kern_value(gpos, first, second):
    """Sum of x-advance adjustments for the first glyph of a pair, over the 'kern' lookups (first match per lookup)."""
    idx = {i for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == 'kern' for i in fr.Feature.LookupListIndex}
    total = 0
    for i in sorted(idx):
        lookup = gpos.LookupList.Lookup[i]
        for st in lookup.SubTable:
            if st.LookupType == 9:
                st = st.ExtSubTable
            if st.LookupType != 2 and st.__class__.__name__ != 'PairPos':
                continue
            if first not in st.Coverage.glyphs:
                continue
            if st.Format == 1:
                ps = st.PairSet[st.Coverage.glyphs.index(first)]
                hit = next((r for r in ps.PairValueRecord if r.SecondGlyph == second), None)
                if hit is not None:
                    v = hit.Value1
                    total += getattr(v, 'XAdvance', 0) or 0 if v else 0
                    break
            else:
                c1 = st.ClassDef1.classDefs.get(first, 0)
                c2 = st.ClassDef2.classDefs.get(second, 0)
                v = st.Class1Record[c1].Class2Record[c2].Value1
                x = (getattr(v, 'XAdvance', 0) or 0) if v else 0
                if x:
                    total += x
                    break
    return total


def outline(font, text, spacing_em):
    """Returns (path d in y-down units with the baseline at y=0, bounds (xmin, ymin, xmax, ymax), upem)."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font['hmtx']
    upem = font['head'].unitsPerEm
    names = [cmap[ord(ch)] for ch in text]
    pen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    bp = BoundsPen(gs)
    x = 0.0
    for i, name in enumerate(names):
        # flip y so the SVG is y-down with the baseline at 0
        for p in (pen, bp):
            tp = TransformPen(p, (1, 0, 0, -1, x, 0))
            gs[name].draw(tp)
        adv = hmtx[name][0]
        if i + 1 < len(names):
            adv += kern_value(font['GPOS'].table, name, names[i + 1])
        x += adv + spacing_em * upem
    return pen.getCommands(), bp.bounds, upem


def load(ttf, wdth, wght):
    return instancer.instantiateVariableFont(TTFont(ttf), {'wdth': wdth, 'wght': wght}, inplace=False)


def main():
    ttf = sys.argv[1]
    # wordmark
    f = load(ttf, 120, 650)
    d, (x0, y0, x1, y1), upem = outline(f, 'vitals', -0.02)
    xh = f['OS/2'].sxHeight
    w, h = x1 - x0, y1 - y0
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0:.0f} {y0:.0f} {w:.0f} {h:.0f}" fill="currentColor">\n'
        f'  <!--\n'
        f'    "vitals" as outlines: Archivo variable, wdth 120, wght 650, letter-spacing -0.02em, GPOS kerning applied.\n'
        f'    Units are font units ({upem} per em). The baseline is y=0 and the x-height is y={-xh}; the viewBox is tight to the glyphs\n'
        f'    (the l and t ascend to y={y0:.0f}, no descenders). Made by scripts/brand/wordmark-outline.py; no live text, no font needed.\n'
        f'  -->\n'
        f'  <path id="wordmark" d="{d}"/>\n</svg>\n'
    )
    (ROOT / 'public/brand/wordmark.svg').write_text(svg)
    print('wordmark', x0, y0, x1, y1, 'xheight', xh)
    # tagline
    f = load(ttf, 100, 450)
    d, (x0, y0, x1, y1), upem = outline(f, TAGLINE, 0)
    out = {
        'text': TAGLINE, 'font': 'Archivo variable', 'wdth': 100, 'wght': 450, 'unitsPerEm': upem,
        'xHeight': f['OS/2'].sxHeight, 'capHeight': f['OS/2'].sCapHeight,
        'bounds': [round(x0), round(y0), round(x1), round(y1)], 'd': d,
    }
    (ROOT / 'scripts/brand/tagline-outline.json').write_text(json.dumps(out, indent=1) + '\n')
    print('tagline', x0, y0, x1, y1)


main()
