#!/usr/bin/env python3
"""Static Geist and Geist Mono instances for the Android home-screen widgets (r071 W2).

RemoteViews can only name a font file of the app (`android:fontFamily="@font/geist_light"`), not a variable font axis,
so the widgets ship four small static instances cut from the same files the web app ships (fontsource, OFL 1.1):

  geist_light.ttf        Geist 300   hero numerals (the web's display role: Geist 300, proportional figures)
  geist_regular.ttf      Geist 400   units, state words
  geist_semibold.ttf     Geist 600   card titles, key labels
  geist_mono_medium.ttf  Geist Mono 500   the mono caps of facts

Latin only (the fontsource "latin" range), hinting dropped, the OpenType features kept (tnum and pnum matter).
The licence texts sit next to them in apps/android/design/fonts/.

  python3 -I scripts/android-fonts.py --from node_modules/@fontsource-variable --out apps/android/design/res/font

`--from` is a folder holding `geist/files/geist-latin-wght-normal.woff2` and `geist-mono/files/...` (fontsource
5.3.0, the version the web app pins). Needs fontTools and brotli (`pip install fonttools brotli`).
"""
import argparse
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# the fontsource "latin" unicode-range, so the widget draws what the web's latin file draws
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [0x131, 0x152, 0x153, 0x2C6, 0x2DA, 0x2DC, 0x2074, 0x20AC, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215]
    + list(range(0x2000, 0x2070))
)

FONTS = [
    ("geist", "geist-latin-wght-normal.woff2", 300, "geist_light.ttf"),
    ("geist", "geist-latin-wght-normal.woff2", 400, "geist_regular.ttf"),
    ("geist", "geist-latin-wght-normal.woff2", 600, "geist_semibold.ttf"),
    ("geist-mono", "geist-mono-latin-wght-normal.woff2", 500, "geist_mono_medium.ttf"),
]


def build(src: str, wght: int, dest: str) -> int:
    font = TTFont(src)
    font = instancer.instantiateVariableFont(font, {"wght": wght}, inplace=False)
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.hinting = False
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    opts.glyph_names = False
    opts.flavor = None
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = None
    font.save(dest)
    return os.path.getsize(dest)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True, help="folder with geist/ and geist-mono/ (fontsource-variable)")
    ap.add_argument("--out", required=True, help="apps/android/design/res/font")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for family, file, wght, name in FONTS:
        src = os.path.join(a.src, family, "files", file)
        if not os.path.exists(src):
            print(f"missing {src}", file=sys.stderr)
            return 1
        size = build(src, wght, os.path.join(a.out, name))
        print(f"{name}: {size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
