#!/usr/bin/env python3
"""The Android widget picker's preview images (r071).

The picker shows `previewImage` on every Android version (from 12 a `previewLayout` would draw the live layout with no
figures in it). The images are the widgets themselves, drawn by the Robolectric test `WidgetPreviewsTest` with the code that
draws them on the home screen, from the sample numbers (never a person's own). This turns those renders into lossy WebP
in `res/drawable-nodpi` (a gradient glow is small as WebP and large as PNG).

  cd apps/android/android && ./gradlew :app:testDebugUnitTest --tests 'desi.creative.vitals.widgets.WidgetPreviewsTest'
  python3 -I scripts/android-previews.py

Run it when a widget's look changes, and commit the images. Needs Pillow (`pip install pillow`).
"""
import argparse
import glob
import os
import sys

from PIL import Image


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", default="apps/android/android/app/build/outputs/widget-previews")
    ap.add_argument("--out", default="apps/android/android/app/src/main/res/drawable-nodpi")
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.src, "vw_preview_*.png")))
    if not files:
        print(f"no renders in {a.src}: run WidgetPreviewsTest first", file=sys.stderr)
        return 1
    os.makedirs(a.out, exist_ok=True)
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0] + ".webp"
        dest = os.path.join(a.out, name)
        Image.open(f).convert("RGBA").save(dest, "WEBP", quality=92, alpha_quality=100, method=6)
        print(f"{name}: {os.path.getsize(dest)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
