"""Fetch the official BodyParts3D 4.0 reduced OBJ atlas for bake-anatomy.py.

The 137 MiB ZIP stays in scripts/figure/.cache and is never shipped to users.
The archive's embedded licence header predates the licensor's 2025-02-27
licence update; see the current official licence page and LICENSES.md.
"""

from pathlib import Path
import hashlib
import urllib.request

URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip"
SHA256 = "40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e"
DEST = Path(__file__).parent / ".cache" / "isa_BP3D_4.0_obj_99.zip"


def main() -> None:
    DEST.parent.mkdir(exist_ok=True)
    if not DEST.exists():
        with urllib.request.urlopen(URL) as source, DEST.open("wb") as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)
    actual = hashlib.sha256(DEST.read_bytes()).hexdigest()
    if actual != SHA256:
        raise SystemExit(f"BodyParts3D archive checksum mismatch: {actual}")
    print(f"Verified {DEST} ({DEST.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
