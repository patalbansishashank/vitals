#!/usr/bin/env python3
"""Generate every Vitals brand asset from one geometry: web, desktop, Android, lockups and the in-app mark.

Usage (from the repo root, or via `pnpm brand`):
    python3 design/brand/vitals-mark.py                 write every asset in place
    python3 design/brand/vitals-mark.py --sheet OUT.png [--gauge GAUGE.png]
                                                        also render the review sheet; GAUGE.png is Gauge's 48 px
                                                        round launcher icon (mipmap-mdpi/ic_launcher_round.png),
                                                        shown beside Vitals
Needs rsvg-convert (librsvg) and Pillow. Output is deterministic.

The mark: "the plan ring". It belongs to Gauge's reading-ring family (thin ring on #090909, Ember gold and ivory,
round caps, the same radius, weights and safe zones) with the colour roles swapped. Gauge measures: a gold reading
arc over 70 % of a hairline bezel with an ivory dot where the reading stops. Vitals plans: an ivory ring drawn almost
all the way round, left open at four o'clock where the next part of the plan has not been lived yet (only the
hairline bezel crosses it), and a gold dot inside the ring aimed at that opening: the next thing to do, the same gold
as "Next up". Gold ring + dot on the ring (upper-left gap) against ivory ring + dot inside (lower-right gap): the two
never read alike, even at 16 px.

The weights and sizes are not in this file: design/brand/mark-geometry.json holds them (ring edge, strokes, hairline,
dot sizes, size tiers, canvases) and Gauge's generator reads an identical copy, so every line and circle matches
between the two marks; this script adds only the opening and where the dot sits. Geometry lives in a 24-unit design
space (centre 12,12). Every colour cut keeps its outer edge at 9.95 units, so every output scales one footprint:
Android 108 dp layers at 3x (outer edge 29.85 dp, inside the 33 dp safe radius), web and desktop icons at a fraction
of their side; the 24 dp notification icon uses the shared notification ring (edge 9.4, at 1x). Renders of 24 px and
under use the small cut (heavier ring, wider opening, larger dot, no hairline); 25-40 px the medium cut; larger
renders the standard cut.
"""
from __future__ import annotations

import json
import math
import pathlib
import re
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = "design/brand/vitals-mark.py"

GOLD, IVORY, BG = "#e3bf78", "#f5f1e9", "#090909"
EMBER = {"ground": BG, "ink": IVORY, "signal": GOLD, "edge": None}
# For a light ground a file cannot control (a lockup on a light page, a tray icon on a light panel): the Ember ground
# colour becomes the ink and the gold dot keeps a thin ink edge so it holds on white.
LIGHT = {"ground": IVORY, "ink": BG, "signal": GOLD, "edge": BG}

# The geometry both sister marks share (Gauge's reading ring reads the same file): ring edge, strokes, hairline, dot
# sizes, size tiers, canvases. Only the Vitals-specific numbers (the opening and where the dot sits) are under "vitals".
SPEC = json.loads((HERE / "mark-geometry.json").read_text())
C = float(SPEC["centre"])               # centre of the 24-unit design space
OUTER = float(SPEC["outer"])            # every cut's outer edge (ring radius + half its stroke), but the notification's
BISECTOR = float(SPEC["vitals"]["bisector_deg"])  # the opening faces this angle (clockwise from 3 o'clock): about four o'clock
SMALL_MAX = int(SPEC["tiers"]["small_max_px"])    # renders of this many px and under use the small cut
MEDIUM_MAX = int(SPEC["tiers"]["medium_max_px"])  # then the medium cut up to this many px


def f(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".")


def pt(r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return C + r * math.cos(a), C + r * math.sin(a)


@dataclass(frozen=True)
class Cut:
    name: str
    r: float          # ring radius
    stroke: float     # ring stroke
    open_deg: float   # the opening, centred on BISECTOR
    track: float      # hairline bezel stroke (0: none)
    track_alpha: float
    dot_at: float     # dot centre's distance from the centre
    dot_r: float
    edge: float       # dot edge width on light grounds

    @property
    def start(self) -> float:   # the ring starts after the opening and runs clockwise round to it
        return BISECTOR + self.open_deg / 2

    @property
    def end(self) -> float:
        return BISECTOR - self.open_deg / 2

    @property
    def sweep(self) -> float:
        return 360 - self.open_deg

    @property
    def ring_d(self) -> str:
        (x0, y0), (x1, y1) = pt(self.r, self.start), pt(self.r, self.end)
        return f"M{f(x0)},{f(y0)} A{f(self.r)},{f(self.r)} 0 1 1 {f(x1)},{f(y1)}"

    @property
    def length(self) -> float:
        return round(self.r * math.radians(self.sweep), 2)

    @property
    def dot(self) -> tuple[float, float]:
        x, y = pt(self.dot_at, BISECTOR)
        return round(x, 3), round(y, 3)


def spec_cut(name: str, g: dict, outer: float = OUTER) -> Cut:
    """A cut from the shared spec: g carries stroke / track / track_alpha / dot_r; the opening and the dot's place are
    Vitals' own."""
    v = SPEC["vitals"]
    return Cut(name, r=round(outer - g["stroke"] / 2, 4), stroke=g["stroke"], open_deg=v["open_deg"][name],
               track=g["track"], track_alpha=g["track_alpha"], dot_at=v["dot_at"][name], dot_r=g["dot_r"],
               edge=v["dot_edge"][name])


# Colour, above 24 px: launcher, splash, PWA and desktop icons, lockups, the in-app mark.
STANDARD = spec_cut("standard", SPEC["tiers"]["standard"])
# 24 px and under (favicons, small desktop icons, tray, the 22 px sidebar mark): the ring thickens, the opening widens so
# it stays open at 16 px, the dot grows; the hairline would only be mud, so it goes.
SMALL = spec_cut("small", SPEC["tiers"]["small"])
# 25-40 px (32 px favicon frame, 32-40 px desktop icons): between the two.
MEDIUM = spec_cut("medium", SPEC["tiers"]["medium"])
# One colour, alpha only (Android themed icon, PWA monochrome): the ring a touch heavier, the bezel a fainter hairline,
# the dot larger. The same numbers as Gauge's themed icon.
MONO = spec_cut("themed", SPEC["mono"]["themed"], SPEC["mono"]["themed"]["outer"])
# The notification icon: 24 dp white silhouette, the small weight with the mono hairline and dot, on the smaller ring
# Gauge's notification uses (outer edge 9.4) so the two status-bar icons are the same size.
NOTIF = spec_cut("notification", SPEC["mono"]["notification"], SPEC["mono"]["notification"]["outer"])

for _c in (STANDARD, MEDIUM, SMALL, MONO):
    assert abs(_c.r + _c.stroke / 2 - OUTER) < 1e-9, _c.name
for _c in (STANDARD, MEDIUM, SMALL, MONO, NOTIF):
    assert _c.dot_at + _c.dot_r < _c.r - _c.stroke / 2 - 1, _c.name  # the dot stays clear inside the ring


def cut_for(px: float) -> Cut:
    return SMALL if px <= SMALL_MAX else MEDIUM if px <= MEDIUM_MAX else STANDARD


# ------------------------------------------------------------------------------------------------ SVG building blocks

def circle_d(cx: float, cy: float, r: float) -> str:
    """A circle as path data (Android vectors have no <circle>)."""
    return f"M{f(cx - r)},{f(cy)} a{f(r)},{f(r)} 0 1 0 {f(2 * r)},0 a{f(r)},{f(r)} 0 1 0 {f(-2 * r)},0 Z"


def shapes(cut: Cut, pal: dict, mono: str | None = None) -> str:
    """The mark's SVG elements in the 24-unit space, back to front: hairline bezel, ring, dot."""
    ink = mono or pal["ink"]
    signal = mono or pal["signal"]
    edge = None if mono else pal["edge"]
    out = []
    if cut.track:
        out.append(f'<circle cx="{f(C)}" cy="{f(C)}" r="{f(cut.r)}" fill="none" stroke="{ink}" '
                   f'stroke-width="{f(cut.track)}" stroke-opacity="{f(cut.track_alpha)}"/>')
    out.append(f'<path d="{cut.ring_d}" fill="none" stroke="{ink}" stroke-width="{f(cut.stroke)}" stroke-linecap="round"/>')
    dx, dy = cut.dot
    e = f' stroke="{edge}" stroke-width="{f(cut.edge)}"' if edge and cut.edge else ""
    out.append(f'<circle cx="{f(dx)}" cy="{f(dy)}" r="{f(cut.dot_r)}" fill="{signal}"{e}/>')
    return "".join(out)


def placed(size: float, frac: float, cut: Cut, pal: dict = EMBER, mono: str | None = None, cx=None, cy=None) -> str:
    """The mark scaled so its outer edge sits at frac x size from the centre of a size-wide square."""
    k = frac * size / OUTER
    cx = size / 2 if cx is None else cx
    cy = size / 2 if cy is None else cy
    return f'<g transform="translate({f(cx - C * k)} {f(cy - C * k)}) scale({f(k)})">{shapes(cut, pal, mono)}</g>'


def svg(w: float, h: float | None = None, body: str = "") -> str:
    h = w if h is None else h
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{f(w)}" height="{f(h)}" viewBox="0 0 {f(w)} {f(h)}">'
            f"{body}</svg>")


# Placement: the mark's outer edge as a fraction of the icon's side, per use.
FRAC = {
    "tile": 0.37,        # rounded tiles over 24 px (PWA any, desktop, Windows, Linux, the macOS tile)
    "tile_small": 0.4375,  # tiles of 48 px and under (favicons, small desktop icons): 2 px in from a 32 px tile's edge
    "bleed": 0.37,       # apple-touch: opaque, iOS rounds the corners itself
    "maskable": 0.34,    # PWA maskable and monochrome: inside the 0.40 safe circle with a margin
    "tray": 0.45,        # tray and menu bar glyphs: about 1 px clear at 16 px
}
CORNER = 0.22            # rounded-tile corner radius / side
MAC_TILE, MAC_CORNER = 824 / 1024, 0.225  # macOS Big Sur template: 824 of 1024, centred


def tile_svg(size: int, inset: float = 0, corner: float = CORNER) -> str:
    small = size <= 48
    x = inset * size
    w = size - 2 * x
    frac = (FRAC["tile_small"] if small else FRAC["tile"]) * w / size
    return svg(size, body=f'<rect x="{f(x)}" y="{f(x)}" width="{f(w)}" height="{f(w)}" rx="{f(corner * w)}" fill="{BG}"/>'
               + placed(size, frac, cut_for(size)))


def bleed_svg(size: int, frac: float) -> str:
    return svg(size, body=f'<rect width="{size}" height="{size}" fill="{BG}"/>' + placed(size, frac, cut_for(size)))


def glyph_svg(size: int, frac: float, cut: Cut | None = None, pal: dict = EMBER, mono: str | None = None) -> str:
    return svg(size, body=placed(size, frac, cut or cut_for(size), pal, mono))


# ------------------------------------------------------------------------------------------------ rasterising, containers

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="vitals-mark-"))
_n = 0


def png(svg_text: str, w: int, h: int | None = None) -> bytes:
    """librsvg render of an SVG to exactly w x h px (RGBA)."""
    global _n
    _n += 1
    src, dst = _TMP / f"{_n}.svg", _TMP / f"{_n}.png"
    src.write_text(svg_text)
    subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h or w), "-o", str(dst), str(src)], check=True)
    return dst.read_bytes()


def ico(images: list[tuple[int, bytes]]) -> bytes:
    """A .ico holding one PNG per size."""
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, data = b"", b""
    for size, blob in images:
        s = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(blob), offset + len(data))
        data += blob
    return head + entries + data


ICNS_TYPES = [("icp4", 16), ("icp5", 32), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
              ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]


def icns(images: list[tuple[str, bytes]]) -> bytes:
    body = b"".join(t.encode() + struct.pack(">I", 8 + len(b)) + b for t, b in images)
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


# ------------------------------------------------------------------------------------------------ outputs

OUT: dict[str, bytes | str] = {}


def put(rel: str, data: bytes | str) -> None:
    OUT[rel] = data


GEN_NOTE = f"Generated by {SCRIPT}; edit that script, not this file."


def mark_svg(cut: Cut) -> str:
    """public/brand/mark*.svg: transparent, the ink follows the viewer's ground (dark: Ember; light: ink #090909)."""
    dx, dy = cut.dot
    track = ""
    if cut.track:
        track = f'  <circle id="track" class="track" cx="{f(C)}" cy="{f(C)}" r="{f(cut.r)}"/>\n'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n'
        "  <!--\n"
        f"    Vitals mark, {cut.name} cut: the plan ring. An ivory ring left open at four o'clock, a hairline bezel across\n"
        "    the opening, and a gold dot inside aimed at it (the next thing to do). Gauge's reading-ring family with the\n"
        "    colour roles swapped. 24-unit design space, centre 12,12, outer edge 9.95.\n"
        f"    {GEN_NOTE}\n"
        "  -->\n"
        "  <style>\n"
        f"    .track {{ fill: none; stroke: {LIGHT['ink']}; stroke-width: {f(cut.track)}; stroke-opacity: {f(cut.track_alpha)}; }}\n"
        f"    .ring {{ fill: none; stroke: {LIGHT['ink']}; stroke-width: {f(cut.stroke)}; stroke-linecap: round; }}\n"
        f"    .dot {{ fill: {GOLD}; stroke: {LIGHT['edge']}; stroke-width: {f(cut.edge)}; }}\n"
        "    @media (prefers-color-scheme: dark) {\n"
        f"      .track, .ring {{ stroke: {IVORY}; }}\n"
        "      .dot { stroke: none; }\n"
        "    }\n"
        "  </style>\n"
        f"{track}"
        f'  <path id="ring" class="ring" d="{cut.ring_d}"/>\n'
        f'  <circle id="dot" class="dot" cx="{f(dx)}" cy="{f(dy)}" r="{f(cut.dot_r)}"/>\n'
        "</svg>\n"
    )


# In-app crop: the outer edge (9.95) plus a hair, so a RingMark's size is the visible ring.
CROP = (2, 2, 20)
DRAW_ON = {"trim_from": 0.05, "ring_ms": 500, "dot_delay_ms": 420, "dot_ms": 220}


def ts_cut(cut: Cut) -> str:
    dx, dy = cut.dot
    track = (f"{{ r: {f(cut.r)}, stroke: {f(cut.track)}, opacity: {f(cut.track_alpha)} }}" if cut.track else "null")
    return (
        "{\n"
        f"  track: {track},\n"
        f"  ring: {{ d: '{cut.ring_d}', r: {f(cut.r)}, stroke: {f(cut.stroke)}, openDeg: {f(cut.open_deg)}, length: {cut.length} }},\n"
        f"  dot: {{ cx: {f(dx)}, cy: {f(dy)}, r: {f(cut.dot_r)}, edge: {f(cut.edge)} }},\n"
        "}"
    )


def write_web() -> None:
    put("public/brand/mark.svg", mark_svg(STANDARD))
    put("public/brand/mark-small.svg", mark_svg(SMALL))
    put("public/favicon.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="{f(CORNER * 32)}" '
        f'fill="{BG}"/>{placed(32, FRAC["tile_small"], SMALL)}</svg>\n')
    put("public/favicon.ico", ico([(s, png(tile_svg(s), s)) for s in (16, 32, 48)]))
    put("public/icons/apple-touch-icon-180.png", png(bleed_svg(180, FRAC["bleed"]), 180))
    for s in (192, 512):
        put(f"public/icons/icon-{s}.png", png(tile_svg(s), s))
        put(f"public/icons/icon-{s}-maskable.png", png(bleed_svg(s, FRAC["maskable"]), s))
    put("public/icons/icon-512-monochrome.png", png(glyph_svg(512, FRAC["maskable"], MONO, mono="#ffffff"), 512))

    # The in-app mark (RingMark, the sidebar, top bar and welcome page) reads these numbers.
    put("src/components/brand/mark-geometry.ts",
        f"// {GEN_NOTE}\n"
        "// The Vitals mark (the plan ring) in its 24-unit design space, centre 12,12. geometry.ts adds the palette and the\n"
        "// draw-on timing; RingMark, the pre-JS start screen and every icon are drawn from these numbers.\n\n"
        "export const GRID = 24;\n"
        f"export const CENTRE = {f(C)};\n"
        f"/** Ring radius + half its stroke, the same in every cut. */\nexport const OUTER = {f(OUTER)};\n"
        f"/** The opening faces this angle (degrees clockwise from 3 o'clock); the dot sits on it. */\nexport const BISECTOR_DEG = {f(BISECTOR)};\n"
        f"/** The crop RingMark and the start screen use: the outer edge plus a hair. */\n"
        f"export const CROP = {{ x: {CROP[0]}, y: {CROP[1]}, size: {CROP[2]} }} as const;\n"
        f"/** Marks of this many px and under use the small cut, then the medium cut up to MEDIUM_CUT_MAX_PX. */\n"
        f"export const SMALL_CUT_MAX_PX = {SMALL_MAX};\nexport const MEDIUM_CUT_MAX_PX = {MEDIUM_MAX};\n\n"
        f"/** Above {SMALL_MAX} px: hairline bezel, ivory ring open over {f(STANDARD.open_deg)} degrees, gold dot inside. */\n"
        f"export const STANDARD = {ts_cut(STANDARD)} as const;\n\n"
        f"/** {SMALL_MAX + 1}-{MEDIUM_MAX} px: a heavier ring, opening {f(MEDIUM.open_deg)} degrees. */\n"
        f"export const MEDIUM = {ts_cut(MEDIUM)} as const;\n\n"
        f"/** {SMALL_MAX} px and under: heavier ring, opening widened to {f(SMALL.open_deg)} degrees, larger dot, no hairline. */\n"
        f"export const SMALL = {ts_cut(SMALL)} as const;\n\n"
        "/** One colour (Android themed icon, PWA monochrome): a heavier ring, a fainter hairline, a larger dot. */\n"
        f"export const MONO = {ts_cut(MONO)} as const;\n\n"
        f"/** The Android notification icon: the shared notification ring (outer edge {f(NOTIF.r + NOTIF.stroke / 2)}), "
        "the small weight with the mono hairline and dot. */\n"
        f"export const NOTIFICATION = {ts_cut(NOTIF)} as const;\n")

    # The pre-JS start screen (index.html + public/brand/launch.css): the standard cut, drawn on before any script runs.
    s = STANDARD
    dx, dy = s.dot
    trim = round(s.length * (1 - DRAW_ON["trim_from"]), 2)
    launch_svg = (
        f'<svg class="vitals-launch__mark" viewBox="{CROP[0]} {CROP[1]} {CROP[2]} {CROP[2]}" width="88" height="88" focusable="false">\n'
        f'          <circle class="vitals-launch__track" cx="{f(C)}" cy="{f(C)}" r="{f(s.r)}" />\n'
        f'          <path class="vitals-launch__ring" d="{s.ring_d}" />\n'
        f'          <circle class="vitals-launch__dot" cx="{f(dx)}" cy="{f(dy)}" r="{f(s.dot_r)}" />\n'
        "        </svg>"
    )
    html = (ROOT / "index.html").read_text()
    html, n = re.subn(r'<svg class="vitals-launch__mark".*?</svg>', lambda _: launch_svg, html, flags=re.S)
    assert n == 1, "index.html: start-screen <svg> not found"
    put("index.html", html)
    put("public/brand/launch.css", LAUNCH_CSS.format(
        script=SCRIPT, length=s.length, trim=trim, track=f(s.track), track_alpha=f(s.track_alpha),
        stroke=f(s.stroke), edge=f(s.edge), ground=BG, ink=IVORY, signal=GOLD, **DRAW_ON))


LAUNCH_CSS = """/* ==========================================================================
   Vitals start screen: the mark, drawn on before any JavaScript runs.
   Generated by {script}; edit that script, not this file.
   index.html puts a static copy of the mark inside #root; React replaces it on
   its first render and src/components/brand/LaunchScreen.tsx carries the same
   animation on from where this one was. No tokens here (tokens.css arrives with
   the app), so the Ember colours are written out: backdrop {ground}, ink
   {ink}, gold {signal}, no edge on the dot: the same values as --lm-chassis,
   --lm-ink and --lm-signal. Dark only: there is no light ground and no theme
   branch. The hairline bezel is there from the first frame; the ivory ring
   draws round it ({length} units, 5 % trim = offset {trim}) in {ring_ms} ms, then
   the gold dot pops in ({dot_ms} ms from {dot_delay_ms} ms).
   ========================================================================== */
html {{
  background: {ground};
  color-scheme: dark;
}}
.vitals-launch {{
  position: fixed;
  inset: 0;
  z-index: 900;
  display: grid;
  place-items: center;
  background: {ground};
  --vl-ink: {ink};
  --vl-signal: {signal};
  --vl-edge: transparent;
  --vl-edge-width: {edge};
}}

.vitals-launch__mark {{
  display: block;
  overflow: visible;
}}
.vitals-launch__track {{
  fill: none;
  stroke: var(--vl-ink);
  stroke-width: {track};
  stroke-opacity: {track_alpha};
}}
.vitals-launch__ring {{
  fill: none;
  stroke: var(--vl-ink);
  stroke-width: {stroke};
  stroke-linecap: round;
  stroke-dasharray: {length};
  stroke-dashoffset: 0;
  animation: vitals-launch-draw {ring_ms}ms cubic-bezier(0.4, 0, 0.2, 1) both;
}}
.vitals-launch__dot {{
  fill: var(--vl-signal);
  stroke: var(--vl-edge);
  stroke-width: var(--vl-edge-width);
  transform-box: fill-box;
  transform-origin: center;
  animation: vitals-launch-pop {dot_ms}ms cubic-bezier(0.34, 1.36, 0.64, 1) {dot_delay_ms}ms both;
}}
@keyframes vitals-launch-draw {{
  from {{
    stroke-dashoffset: {trim};
  }}
  to {{
    stroke-dashoffset: 0;
  }}
}}
@keyframes vitals-launch-pop {{
  from {{
    transform: scale(0);
  }}
  to {{
    transform: scale(1);
  }}
}}

/* Reduced motion shows the still mark: the settings override (data-motion) wins, else the OS preference. */
html[data-motion='reduce'] .vitals-launch__ring,
html[data-motion='reduce'] .vitals-launch__dot {{
  animation: none;
}}
@media (prefers-reduced-motion: reduce) {{
  html:not([data-motion='full']) .vitals-launch__ring,
  html:not([data-motion='full']) .vitals-launch__dot {{
    animation: none;
  }}
}}
"""


ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]


def write_desktop() -> None:
    d = "apps/desktop/build/icons"
    mac = lambda s: tile_svg(s, inset=(1 - MAC_TILE) / 2, corner=MAC_CORNER)  # noqa: E731
    put(f"{d}/icon.ico", ico([(s, png(tile_svg(s), s)) for s in ICO_SIZES]))
    put(f"{d}/icon.icns", icns([(t, png(mac(s), s)) for t, s in ICNS_TYPES]))
    put(f"{d}/icon.png", png(tile_svg(1024), 1024))
    for s in LINUX_SIZES:
        put(f"{d}/png/{s}x{s}.png", png(tile_svg(s), s))
    for s in (16, 32):
        put(f"{d}/tray/tray-{s}.png", png(glyph_svg(s, FRAC["tray"], SMALL, EMBER), s))       # dark panels
        put(f"{d}/tray/tray-dark-{s}.png", png(glyph_svg(s, FRAC["tray"], SMALL, LIGHT), s))  # light panels
    put(f"{d}/tray/trayTemplate.png", png(glyph_svg(16, FRAC["tray"], SMALL, mono="#000000"), 16))
    put(f"{d}/tray/trayTemplate@2x.png", png(glyph_svg(32, FRAC["tray"], SMALL, mono="#000000"), 32))


# ------------------------------------------------------------------------------------------------ Android

A_HEAD = '<?xml version="1.0" encoding="utf-8"?>\n'
A_NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'
K_LAUNCH = 3.0     # 24 units x 3 = the 72 dp visible window of a 108 dp layer; outer edge 29.85 dp < 33 dp safe radius
SPLASH = {"ring_ms": 500, "dot_offset_ms": 420, "dot_ms": 220, "total_ms": 700, "tension": 1.2}
LAUNCHER_MASKS = {  # AOSP shape paths on a 100 box, applied to the visible 72 dp
    "circle": "M50,0 A50,50 0,1 1,50,100 A50,50 0,1 1,50,0 Z",
    "squircle": "M50,0 C10,0 0,10 0,50 C0,90 10,100 50,100 C90,100 100,90 100,50 C100,10 90,0 50,0 Z",
    "rounded-square": "M50,0 L92,0 C96.42,0 100,3.58 100,8 L100,92 C100,96.42 96.42,100 92,100 L8,100 "
                      "C3.58,100 0,96.42 0,92 L0,8 C0,3.58 3.58,0 8,0 Z",
    "teardrop": "M50,0 A50,50 0,0 1 100,50 L100,85 A15,15 0,0 1 85,100 L50,100 A50,50 0,0 1 0,50 A50,50 0,0 1 50,0 Z",
}


def a_vector(dp: int, viewport: int, cut: Cut, colours: dict, k: float, comment: str, splash: bool = False) -> str:
    """A vector drawable of the mark scaled k about the viewport centre. colours: ink, signal (hex or @color/...)."""
    off = viewport / 2 - C * k
    dx, dy = cut.dot
    ind = "        "
    lines = [A_HEAD.rstrip("\n"), f"<!-- {GEN_NOTE} {comment} -->", f"<vector {A_NS}",
             f'    android:width="{dp}dp" android:height="{dp}dp"',
             f'    android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">',
             f'    <group{" android:name=" + chr(34) + "mark" + chr(34) if splash else ""} android:translateX="{f(off)}" '
             f'android:translateY="{f(off)}" android:scaleX="{f(k)}" android:scaleY="{f(k)}">']
    if cut.track:
        lines.append(f'{ind}<path android:name="track" android:pathData="{circle_d(C, C, cut.r)}"\n'
                     f'{ind}    android:fillColor="#00000000" android:strokeColor="{colours["ink"]}" '
                     f'android:strokeAlpha="{f(cut.track_alpha)}"\n{ind}    android:strokeWidth="{f(cut.track)}" />')
    lines.append(f'{ind}<path android:name="ring" android:pathData="{cut.ring_d}"\n'
                 f'{ind}    android:fillColor="#00000000" android:strokeColor="{colours["ink"]}"\n'
                 f'{ind}    android:strokeWidth="{f(cut.stroke)}" android:strokeLineCap="round" />')
    dot = f'android:pathData="{circle_d(dx, dy, cut.dot_r)}" android:fillColor="{colours["signal"]}"'
    if splash:
        lines += [f'{ind}<group android:name="dot" android:pivotX="{f(dx)}" android:pivotY="{f(dy)}" '
                  'android:scaleX="0" android:scaleY="0">', f"{ind}    <path {dot} />", f"{ind}</group>"]
    else:
        lines.append(f"{ind}<path {dot} />")
    lines += ["    </group>", "</vector>", ""]
    return "\n".join(lines)


def a_colours() -> str:
    rows = [("vitals_launcher_background", BG, "launcher icon ground: Ember in both modes"),
            ("vitals_mark_ink", IVORY, "the ring and its hairline bezel"),
            ("vitals_mark_signal", GOLD, "the dot"),
            ("vitals_splash_background", BG, "splash ground")]
    return (A_HEAD + f"<!-- {GEN_NOTE} Ember, dark only: the same in light and night mode. -->\n<resources>\n"
            + "".join(f"    <!-- {note} -->\n    <color name=\"{n}\">{v}</color>\n" for n, v, note in rows)
            + "</resources>\n")


def flat_launcher(size: int, shape: str | None) -> str:
    """The adaptive icon's visible 72 dp (background + foreground), square or through a launcher mask."""
    body = f'<rect width="{size}" height="{size}" fill="{BG}"/>' + placed(size, OUTER / 24, cut_for(size))
    if not shape:
        return svg(size, body=body)
    s = size / 100
    return svg(size, body=f'<clipPath id="m"><path transform="scale({f(s)})" d="{LAUNCHER_MASKS[shape]}"/></clipPath>'
               f'<g clip-path="url(#m)">{body}</g>')


def write_android() -> None:
    b = "apps/android/brand"
    r = f"{b}/res"
    put(f"{r}/values/vitals_brand_colors.xml", a_colours())
    put(f"{r}/values-night/vitals_brand_colors.xml", a_colours())
    put(f"{r}/drawable/vitals_launcher_foreground.xml",
        a_vector(108, 108, STANDARD, {"ink": IVORY, "signal": GOLD}, K_LAUNCH,
                 "Adaptive-icon foreground: fixed Ember colours, outer edge 29.85 dp inside the 33 dp safe zone."))
    put(f"{r}/drawable/vitals_launcher_background.xml",
        A_HEAD + f"<!-- {GEN_NOTE} Adaptive-icon background: the Ember ground. -->\n"
        f'<vector {A_NS}\n    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n'
        '    <path android:fillColor="@color/vitals_launcher_background" android:pathData="M0,0 H108 V108 H0 Z" />\n</vector>\n')
    put(f"{r}/drawable/vitals_launcher_monochrome.xml",
        a_vector(108, 108, MONO, {"ink": "#ffffff", "signal": "#ffffff"}, K_LAUNCH,
                 "Android 13+ themed-icon layer: white, shape in alpha (the launcher tints it)."))
    for name in ("ic_launcher", "ic_launcher_round"):
        put(f"{r}/mipmap-anydpi-v26/{name}.xml",
            A_HEAD + f"<!-- {GEN_NOTE} -->\n<adaptive-icon {A_NS}>\n"
            '    <background android:drawable="@drawable/vitals_launcher_background" />\n'
            '    <foreground android:drawable="@drawable/vitals_launcher_foreground" />\n'
            '    <monochrome android:drawable="@drawable/vitals_launcher_monochrome" />\n</adaptive-icon>\n')
    # Legacy launcher icons (minSdk 26 means the adaptive icon always wins; these keep every density in step).
    for dpi, scale in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        px = int(48 * scale)
        put(f"{r}/mipmap-{dpi}/ic_launcher.png", png(flat_launcher(px, "rounded-square"), px))
        put(f"{r}/mipmap-{dpi}/ic_launcher_round.png", png(flat_launcher(px, "circle"), px))
    # Splash (Android 12+, no icon background): 288 dp, the mark inside the centre 192 dp circle (36 of 54 units).
    put(f"{r}/drawable/vitals_splash_mark.xml",
        a_vector(288, 108, STANDARD, {"ink": "@color/vitals_mark_ink", "signal": "@color/vitals_mark_signal"}, K_LAUNCH,
                 "Splash icon: the hairline is there from the start, the ring (named ring) draws on, the dot pops.",
                 splash=True))
    put(f"{r}/animator/vitals_splash_ring_draw.xml",
        A_HEAD + f"<!-- {GEN_NOTE} -->\n<objectAnimator {A_NS}\n"
        f'    android:propertyName="trimPathEnd" android:valueFrom="{DRAW_ON["trim_from"]}" android:valueTo="1" android:valueType="floatType"\n'
        f'    android:duration="{SPLASH["ring_ms"]}" android:interpolator="@android:interpolator/fast_out_slow_in" />\n')
    put(f"{r}/animator/vitals_splash_dot_pop.xml",
        A_HEAD + f"<!-- {GEN_NOTE} -->\n<set {A_NS} android:ordering=\"together\">\n"
        + "".join(f'    <objectAnimator android:propertyName="{p}" android:valueFrom="0" android:valueTo="1" android:valueType="floatType"\n'
                  f'        android:startOffset="{SPLASH["dot_offset_ms"]}" android:duration="{SPLASH["dot_ms"]}" '
                  'android:interpolator="@interpolator/vitals_splash_overshoot" />\n' for p in ("scaleX", "scaleY"))
        + "</set>\n")
    put(f"{r}/interpolator/vitals_splash_overshoot.xml",
        A_HEAD + f"<!-- {GEN_NOTE} A small overshoot: the dot settles rather than bounces. -->\n"
        f'<overshootInterpolator {A_NS} android:tension="{SPLASH["tension"]}" />\n')
    put(f"{r}/drawable/vitals_splash_animated.xml",
        A_HEAD + f"<!-- {GEN_NOTE} -->\n<animated-vector {A_NS}\n    android:drawable=\"@drawable/vitals_splash_mark\">\n"
        '    <target android:name="ring" android:animation="@animator/vitals_splash_ring_draw" />\n'
        '    <target android:name="dot" android:animation="@animator/vitals_splash_dot_pop" />\n</animated-vector>\n')
    # Notification small icon: 24 dp, white on transparent, the shared notification ring (see NOTIF).
    put(f"{r}/drawable/ic_stat_vitals.xml",
        a_vector(24, 24, NOTIF, {"ink": "#ffffff", "signal": "#ffffff"}, 1.0,
                 "Notification small icon: white on transparent, the shared notification ring (outer edge 9.4, "
                 "2.6 dp padding), hairline bezel at half alpha (Android tints it)."))
    put(f"{b}/playstore-512.png", png(flat_launcher(512, None), 512))
    for shape in LAUNCHER_MASKS:
        put(f"{b}/preview/launcher-{shape}.png", png(flat_launcher(432, shape), 432))
    put(f"{b}/README.md", ANDROID_README.format(script=SCRIPT, **SPLASH))


ANDROID_README = """# Vitals Android brand resources

Generated by `python3 {script}` (`pnpm brand`), the one generator for every Vitals brand asset. Do not edit the
files here by hand: change the geometry in the script and regenerate.

`apps/android/android/app/build.gradle` adds `res/` as a res folder of the app module
(`res.srcDirs += ['../../brand/res']`); the manifest uses `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`.

- `res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml`: the adaptive icon (background, foreground,
  monochrome for Android 13+ themed icons). The ground is Ember (#090909) in light and night mode.
- `res/mipmap-{{m,h,xh,xxh,xxxh}}dpi/ic_launcher.png`, `ic_launcher_round.png`: legacy launcher icons, one per density.
- `res/drawable/vitals_launcher_{{foreground,background,monochrome}}.xml`
- `res/drawable/vitals_splash_mark.xml`, `vitals_splash_animated.xml`, `res/animator/vitals_splash_*.xml`,
  `res/interpolator/vitals_splash_overshoot.xml`: the Android 12+ splash. The hairline bezel shows at once, the ring
  draws on in {ring_ms} ms, the gold dot pops in from {dot_offset_ms} ms and settles by {dot_offset_ms}+{dot_ms} ms; the
  theme gives it {total_ms} ms. With animations off Android shows the finished mark.
- `res/drawable/ic_stat_vitals.xml`: notification small icon (white only, 2 dp padding). The app posts no
  notifications yet; it is here for the first one (`setSmallIcon(R.drawable.ic_stat_vitals)`).
- `res/values(-night)/vitals_brand_colors.xml`
- `playstore-512.png`: Play Store icon (full bleed; Play applies its own mask).
- `preview/launcher-*.png`: the adaptive icon through common launcher masks (documentation only).
"""


# ------------------------------------------------------------------------------------------------ lockups and cards

XH = 100                 # the lockup is drawn with its x-height = 100 units
RING_D = 1.5 * XH        # outer diameter of the mark: one and a half x-heights
GAP = 0.42 * XH          # from the mark's outer edge to the "v"
TAG_ALPHA = 0.74


def read_wordmark() -> dict:
    src = (ROOT / "public/brand/wordmark.svg").read_text()
    vb = [float(v) for v in re.search(r'viewBox="([-\d.\s]+)"', src).group(1).split()]
    d = re.search(r'<path id="wordmark" d="([^"]+)"', src).group(1)
    xh = float(re.search(r"x-height is y=-(\d+)", src).group(1))
    return {"x0": vb[0], "y0": vb[1], "w": vb[2], "h": vb[3], "d": d, "xh": xh}


def lockup_body(tone: str) -> tuple[str, float, float, float]:
    wm = read_wordmark()
    k = XH / wm["xh"]
    pal = {"dark": EMBER, "light": LIGHT, "mono": EMBER}[tone]
    mono = "currentColor" if tone == "mono" else None
    colour = mono or pal["ink"]
    cy = -XH / 2
    mark = placed(RING_D, 0.5, STANDARD, pal, mono, cx=RING_D / 2, cy=0)
    body = (f'<g transform="translate(0 {f(cy)})">{mark}</g>'
            f'<path transform="translate({f(RING_D + GAP - wm["x0"] * k)} 0) scale({f(k)})" fill="{colour}" d="{wm["d"]}"/>')
    top = min(cy - RING_D / 2, wm["y0"] * k)
    bottom = max(cy + RING_D / 2, (wm["y0"] + wm["h"]) * k)
    return body, RING_D + GAP + wm["w"] * k, top, bottom - top


def lockup_svg(tone: str) -> str:
    body, w, top, h = lockup_body(tone)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {f(top)} {f(w)} {f(h)}" width="{round(w * 2)}" height="{round(h * 2)}">\n'
            "  <title>Vitals</title>\n"
            f'  <!-- {GEN_NOTE} The mark, then "vitals" as outlines (no live text). Baseline at y=0. -->\n'
            f"  {body}\n</svg>\n")


def card_svg(width: int, height: int, xh: float, tag_px: float, margin: float, align: str) -> str:
    import json
    body, lw, ltop, lh = lockup_body("dark")
    t = json.loads((HERE / "tagline-outline.json").read_text())
    tx0, ty0, tx1, _ = t["bounds"]
    u = xh / XH
    kt = tag_px / t["unitsPerEm"]
    lock_w, lock_h, tag_w = lw * u, lh * u, (tx1 - tx0) * kt
    gap = tag_px * 1.15
    tag_h = -ty0 * kt
    block_w, block_h = max(lock_w, tag_w), lock_h + gap + tag_h
    x = (width - block_w) / 2 if align == "center" else margin
    y = (height - block_h) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">\n'
            "  <title>Vitals: See what a plan does before you live it.</title>\n"
            f"  <!-- {GEN_NOTE} -->\n"
            f'  <rect width="{width}" height="{height}" fill="{BG}"/>\n'
            f'  <g transform="translate({f(x)} {f(y - ltop * u)}) scale({f(u)})">{body}</g>\n'
            f'  <path transform="translate({f(x - tx0 * kt)} {f(y + lock_h + gap + tag_h)}) scale({f(kt)})" fill="{IVORY}" '
            f'fill-opacity="{TAG_ALPHA}" d="{t["d"]}"/>\n</svg>\n')


def write_lockups() -> None:
    for tone in ("light", "dark", "mono"):
        put(f"public/brand/lockup-{tone}.svg", lockup_svg(tone))
    light = lockup_svg("light")
    vw, vh = (float(v) for v in re.search(r'viewBox="0 [-\d.]+ ([\d.]+) ([\d.]+)"', light).groups())
    put("public/brand/lockup-light-512w.png", png(light, 512, round(512 * vh / vw)))
    put("public/brand/readme-header.svg", card_svg(1280, 320, 62, 30, 96, "left"))
    put("public/brand/social-preview.png", png(card_svg(1280, 640, 100, 40, 0, "center"), 1280, 640))
    put("public/brand/og-image.png", png(card_svg(1200, 630, 100, 40, 0, "center"), 1200, 630))


# ------------------------------------------------------------------------------------------------ review sheet

def review_sheet(out: pathlib.Path, gauge: pathlib.Path | None) -> None:
    """Launcher (circle mask), favicons 16/32/48, a maskable icon with its mask, the notification icon, the in-app
    mark at sidebar size and Vitals beside Gauge at 48 px. Each small render is also shown 4x, pixel for pixel."""
    import io
    from PIL import Image, ImageDraw, ImageFont

    def img(blob: bytes) -> Image.Image:
        return Image.open(io.BytesIO(blob)).convert("RGBA")

    def zoom(im: Image.Image, k: int = 4) -> Image.Image:
        return im.resize((im.width * k, im.height * k), Image.NEAREST)

    font = lambda s: ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", s)  # noqa: E731
    W, H = 1240, 880
    sheet = Image.new("RGBA", (W, H), (34, 34, 34, 255))
    d = ImageDraw.Draw(sheet)
    label = lambda xy, t, s=14: d.text(xy, t, font=font(s), fill=(200, 194, 184, 255))  # noqa: E731

    d.text((24, 16), "Vitals: the plan ring", font=font(24), fill=(245, 241, 233, 255))
    label((24, 48), "ivory ring open at four o'clock, hairline bezel across the opening, gold 'next' dot inside", 14)

    # 1. launcher through a circular mask, 220 px
    label((24, 86), "launcher, circle mask, 220 px")
    sheet.alpha_composite(img(png(flat_launcher(220, "circle"), 220)), (24, 110))
    # themed icon (monochrome layer tinted) and squircle mask beside it
    label((268, 86), "squircle, themed")
    sheet.alpha_composite(img(png(flat_launcher(104, "squircle"), 104)), (268, 110))
    themed = svg(104, body=f'<circle cx="52" cy="52" r="52" fill="#2a3a4a"/>'
                 + placed(104, OUTER / 24, MONO, mono="#cfe3f5"))
    sheet.alpha_composite(img(png(themed, 104)), (268, 226))

    # 2. favicon at 16/32/48 (the .ico's own frames), 1:1 and 4x
    x0 = 420
    label((x0, 86), "favicon.ico 16 / 32 / 48, then zoomed")
    x = x0
    for s in (16, 32, 48):
        im = img(png(tile_svg(s), s))
        sheet.alpha_composite(im, (x, 110 + (48 - s) // 2))
        x += s + 16
    x = x0
    for s in (16, 32, 48):
        z = zoom(im := img(png(tile_svg(s), s)), 4 if s < 48 else 3)
        sheet.alpha_composite(z, (x, 176))
        x += z.width + 16
    # on a light tab strip too
    d.rectangle((x0 + 440, 106, x0 + 560, 160), fill=(242, 242, 242, 255))
    x = x0 + 450
    for s in (16, 32):
        sheet.alpha_composite(img(png(tile_svg(s), s)), (x, 116 + (32 - s) // 2))
        x += s + 14
    label((x0 + 440, 166), "light tab strip", 12)

    # 3. maskable 512, shown at 200: raw with the 40 % safe circle, then through the circle mask
    y3 = 400
    label((24, y3 - 24), "PWA maskable 512 (shown at 200): safe circle, then masked")
    raw = img(png(bleed_svg(512, FRAC["maskable"]), 512)).resize((200, 200), Image.LANCZOS)
    sheet.alpha_composite(raw, (24, y3))
    d.ellipse((24 + 20, y3 + 20, 24 + 180, y3 + 180), outline=(120, 200, 255, 255), width=1)
    mask = Image.new("L", (200, 200), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, 199, 199), fill=255)
    masked = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    masked.paste(raw, (0, 0), mask)
    sheet.alpha_composite(masked, (244, y3))

    # 4. notification icon on dark grey, 24 px (1:1 and 4x), as Android draws the status bar
    x4 = 480
    label((x4, y3 - 24), "notification 24 dp, then 4x")
    note = svg(24, body=f'<rect width="24" height="24" fill="#3c3c3c"/>' + placed(24, OUTER / 24, NOTIF, mono="#ffffff"))
    n = img(png(note, 24))
    sheet.alpha_composite(n, (x4, y3))
    sheet.alpha_composite(zoom(n), (x4 + 40, y3))
    # status bar strip with neighbours
    d.rectangle((x4, y3 + 120, x4 + 200, y3 + 150), fill=(60, 60, 60, 255))
    sheet.alpha_composite(n, (x4 + 8, y3 + 123))
    d.text((x4 + 40, y3 + 125), "12:30", font=font(16), fill=(255, 255, 255, 255))

    # 5. in-app mark at sidebar size (22 px, small cut) beside the title, and at 2x; the launch screen at 88
    x5 = 760
    label((x5, y3 - 24), "in-app: sidebar 22 px, 44, start 88")
    d.rectangle((x5, y3, x5 + 220, y3 + 48), fill=(9, 9, 9, 255))
    crop = f'viewBox="{CROP[0]} {CROP[1]} {CROP[2]} {CROP[2]}"'

    def inapp(px: int) -> Image.Image:
        cut = cut_for(px)
        s = f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" {crop}>{shapes(cut, EMBER)}</svg>'
        return img(png(s, px))

    sheet.alpha_composite(inapp(22), (x5 + 16, y3 + 13))
    d.text((x5 + 48, y3 + 13), "Vitals", font=font(17), fill=(245, 241, 233, 255))
    d.rectangle((x5, y3 + 60, x5 + 220, y3 + 160), fill=(9, 9, 9, 255))
    sheet.alpha_composite(inapp(44), (x5 + 16, y3 + 88))
    sheet.alpha_composite(inapp(88), (x5 + 110, y3 + 66))

    # 6. Vitals beside Gauge at 48 px (each app's own mdpi round launcher icon), 1:1 and 3x
    y6 = 650
    label((24, y6 - 24), "Vitals beside Gauge, 48 px launcher (1:1, then 3x), on a dark and a light home screen")
    v = img(OUT["apps/android/brand/res/mipmap-mdpi/ic_launcher_round.png"])  # type: ignore[arg-type]
    g = Image.open(gauge).convert("RGBA").resize((48, 48), Image.LANCZOS) if gauge else None
    for i, bg in enumerate(((20, 22, 26, 255), (236, 233, 226, 255))):
        bx = 24 + i * 560
        d.rectangle((bx, y6, bx + 540, y6 + 190), fill=bg)
        ink = (230, 230, 230, 255) if i == 0 else (40, 40, 40, 255)
        sheet.alpha_composite(v, (bx + 20, y6 + 20))
        d.text((bx + 22, y6 + 72), "Vitals", font=font(11), fill=ink)
        if g:
            sheet.alpha_composite(g, (bx + 84, y6 + 20))
            d.text((bx + 84, y6 + 72), "Gauge", font=font(11), fill=ink)
        sheet.alpha_composite(zoom(v, 3), (bx + 170, y6 + 20))
        if g:
            sheet.alpha_composite(zoom(g, 3), (bx + 340, y6 + 20))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)


# ------------------------------------------------------------------------------------------------ main

def main() -> None:
    write_web()
    write_desktop()
    write_android()
    write_lockups()
    for rel, data in OUT.items():
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            p.write_text(data)
        else:
            p.write_bytes(data)
    counts: dict[str, int] = {}
    for rel in OUT:
        key = ("android" if rel.startswith("apps/android") else "desktop" if rel.startswith("apps/desktop")
               else "in-app" if rel.startswith(("src/", "index.html", "public/brand/launch")) else "web")
        counts[key] = counts.get(key, 0) + 1
    print(f"{len(OUT)} files: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    if "--sheet" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--sheet") + 1])
        gauge = pathlib.Path(sys.argv[sys.argv.index("--gauge") + 1]) if "--gauge" in sys.argv else None
        review_sheet(out, gauge)
        print(f"sheet: {out}")


if __name__ == "__main__":
    main()
