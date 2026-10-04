"""Bake selected BodyParts3D 4.0 muscle and bone surfaces into a small figure layer.

Run `python scripts/figure/fetch-anatomy.py` first, then this script. Only the
official IS-A tree 99% reduced OBJ archive is used. The atlas is a single adult
male anatomical reference, so the output is an illustration rather than a
person-specific scan. The 8 groups deliberately limit WebGL draw calls.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import gzip
import hashlib
import json
import math
import re
import struct
import zipfile

HERE = Path(__file__).parent
ARCHIVE = HERE / ".cache" / "isa_BP3D_4.0_obj_99.zip"
OUTPUT = HERE / "../../public/figure/anatomy-v1.bin"
REPORT = HERE / "anatomy-bake-report.json"
SOURCE_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip"
SOURCE_SHA256 = "40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e"
SOURCE_SKIN_FLOOR_MM = -78.1112
SOURCE_SKIN_HEIGHT_MM = 1719.4712
REFERENCE_HEIGHT_CM = 165.9
SCALE = REFERENCE_HEIGHT_CM / SOURCE_SKIN_HEIGHT_MM
Z_SHIFT_CM = -3.0
ARM_X_FACTOR = 0.55
ANTERIOR_HINGE_CM = 7.0
ANTERIOR_SCALE = 0.70
# Source shoulder, elbow, wrist, distal middle phalanx height -> corresponding
# adult MakeHuman female/hips-led skin centreline height, inward and posterior
# offsets (cm). The renderer interpolates to the male/shoulders-led endpoint.
ARM_LANDMARKS = (
    (71.0, 71.8, 4.4, 9.8),
    (85.0, 86.9, 2.0, 6.0),
    (107.0, 107.0, 1.0, 4.0),
    (136.0, 136.0, 0.0, 2.4),
)
REGIONS = ("head", "trunk", "arms", "legs")
EXCLUDE_MUSCLE = re.compile(r"tendon|tendinous|ligament|membrane|tract|fascia|aponeurosis|linea alba", re.I)


def part_id(name: str) -> int:
    return int(re.search(r"FJ(\d+)", name).group(1))


def select(name: str, label: str) -> str | None:
    n = part_id(name)
    if 1383 <= n <= 1601 and not EXCLUDE_MUSCLE.search(label):
        return "muscle"
    if 3152 <= n <= 3395:
        return "bone"
    return None


def parse_obj(source: bytes) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    vertices = []
    faces = []
    for line in source.splitlines():
        if line.startswith(b"v "):
            x, y, z = (float(s) for s in line.split()[1:4])
            # BodyParts3D: mm, z up, front is -y. Scale uniformly to the
            # MakeHuman reference stature; modest arm-width correction follows
            # the source skin's hand extent (32 cm) to MakeHuman's (~25 cm).
            x *= SCALE
            if abs(x) > 18:
                x = math.copysign(18 + (abs(x) - 18) * ARM_X_FACTOR, x)
            height = (z - SOURCE_SKIN_FLOOR_MM) * SCALE
            front = -y * SCALE + Z_SHIFT_CM
            # The atlas chest projects farther forward than the reference
            # skin. Compress its anterior half without moving posterior ribs.
            blend = min(1.0, max(0.0, (150 - height) / 15))
            if front > ANTERIOR_HINGE_CM:
                front = ANTERIOR_HINGE_CM + (front - ANTERIOR_HINGE_CM) * (1 - (1 - ANTERIOR_SCALE) * blend)
            vertices.append((x, height, front))
        elif line.startswith(b"f "):
            indices = [int(s.split(b"/")[0]) - 1 for s in line.split()[1:]]
            for i in range(1, len(indices) - 1):
                faces.append((indices[0], indices[i], indices[i + 1]))
    return vertices, faces


def cluster(vertices: list[tuple[float, float, float]], cell: float):
    """Vertex grid clustering; mean each cell, keeping separate source parts."""
    low = tuple(min(v[i] for v in vertices) for i in range(3))
    cells = {}
    remap = []
    sums = []
    for x, y, z in vertices:
        key = (int((x - low[0]) / cell), int((y - low[1]) / cell), int((z - low[2]) / cell))
        idx = cells.get(key)
        if idx is None:
            idx = len(sums)
            cells[key] = idx
            sums.append([0.0, 0.0, 0.0, 0])
        s = sums[idx]
        s[0] += x
        s[1] += y
        s[2] += z
        s[3] += 1
        remap.append(idx)
    return [(x/n, y/n, z/n) for x, y, z, n in sums], remap


def simplify(vertices, faces, target):
    if len(vertices) <= target:
        return vertices, faces
    # Each mesh gets its own cells, so a rib cannot merge into its neighbour.
    lo, hi = 0.001, max(max(v[i] for v in vertices) - min(v[i] for v in vertices) for i in range(3))
    best = None
    for _ in range(13):
        mid = (lo + hi) / 2
        candidate = cluster(vertices, mid)
        if len(candidate[0]) > target:
            lo = mid
        else:
            hi = mid
            best = candidate
    if best is None:
        best = cluster(vertices, hi)
    verts, remap = best
    output = []
    seen = set()
    for a, b, c in faces:
        tri = (remap[a], remap[b], remap[c])
        if len(set(tri)) != 3:
            continue
        key = tuple(sorted(tri))
        if key not in seen:
            seen.add(key)
            output.append(tri)
    return verts, output


def region_of(vertices, label):
    x = sum(v[0] for v in vertices) / len(vertices)
    y = sum(v[1] for v in vertices) / len(vertices)
    lower = label.lower()
    if "hip bone" in lower or "sacrum" in lower or "coccyx" in lower:
        return "trunk"
    if y > 136:
        return "head"
    if abs(x) > 15 and y > 63:
        return "arms"
    if y < 94:
        return "legs"
    return "trunk"


def arm_centerline(y: float) -> tuple[float, float, float]:
    """Map atlas limb cross sections onto the MakeHuman adult arm centreline."""
    if y <= ARM_LANDMARKS[0][0]:
        a, b = ARM_LANDMARKS[0], ARM_LANDMARKS[1]
    elif y >= ARM_LANDMARKS[-1][0]:
        a, b = ARM_LANDMARKS[-2], ARM_LANDMARKS[-1]
    else:
        a, b = next((a, b) for a, b in zip(ARM_LANDMARKS, ARM_LANDMARKS[1:]) if a[0] <= y <= b[0])
    t = (y - a[0]) / (b[0] - a[0])
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, 4))


def main() -> None:
    if not ARCHIVE.exists():
        raise SystemExit("Run python scripts/figure/fetch-anatomy.py first")
    if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit("BodyParts3D source archive checksum mismatch")
    parts = defaultdict(list)
    selected = []
    source_vertices = source_triangles = 0
    with zipfile.ZipFile(ARCHIVE) as atlas:
        for name in sorted(atlas.namelist()):
            if not name.endswith(".obj"):
                continue
            raw = atlas.read(name)
            header = raw[:1500].decode("ascii", "ignore")
            match = re.search(r"English name : (.+)", header)
            if not match:
                continue
            label = match.group(1)
            kind = select(name, label)
            if not kind:
                continue
            vertices, faces = parse_obj(raw)
            if not vertices or not faces:
                continue
            source_vertices += len(vertices)
            source_triangles += len(faces)
            region = region_of(vertices, label)
            if region == "arms":
                posed = []
                for x, y, z in vertices:
                    target_y, inward, posterior = arm_centerline(y)
                    posed.append((math.copysign(max(0, abs(x) - inward), x), target_y, z - posterior))
                vertices = posed
            target = min(len(vertices), max(40, round(2.35 * math.sqrt(len(vertices)))))
            vertices, faces = simplify(vertices, faces, target)
            if not faces:
                continue
            entry = {"id": Path(name).stem, "name": label, "kind": kind, "region": region}
            parts[(kind, region)].append((vertices, faces, entry))
            selected.append(entry)

    vertices = []
    indices = []
    groups = []
    for kind in ("bone", "muscle"):
        for region in REGIONS:
            meshes = parts[(kind, region)]
            if not meshes:
                continue
            start = len(indices)
            group_vertex_start = len(vertices)
            for vv, ff, entry in meshes:
                offset = len(vertices)
                entry["vertexStart"] = offset
                entry["vertexCount"] = len(vv)
                entry["indexStart"] = len(indices)
                entry["indexCount"] = len(ff) * 3
                vertices.extend(vv)
                for face in ff:
                    indices.extend(offset + j for j in face)
            subset = vertices[group_vertex_start:]
            groups.append({
                "kind": kind,
                "region": region,
                "start": start,
                "count": len(indices) - start,
                "anchor": [round(sum(v[i] for v in subset) / len(subset), 3) for i in range(3)],
                "sideAnchorX": round(sum(abs(v[0]) for v in subset) / len(subset), 3),
                "meshes": len(meshes),
            })
    if len(vertices) >= 65536:
        raise SystemExit(f"Too many vertices for compact uint16 indices: {len(vertices)}")
    positions = bytearray()
    for axis in range(3):
        for point in vertices:
            q = round(point[axis] * 100)
            if not -32768 <= q <= 32767:
                raise SystemExit("Position outside int16 centimetre scale")
            positions.extend(struct.pack("<h", q))
    face_bytes = struct.pack("<" + "H" * len(indices), *indices)
    metadata = {
        "format": "vitals-anatomy",
        "version": 1,
        "heightCm": REFERENCE_HEIGHT_CM,
        "positionStepCm": 0.01,
        "vertexCount": len(vertices),
        "triangleCount": len(indices) // 3,
        "groups": groups,
        "source": {
            "name": "BodyParts3D 4.0 IS-A tree, 99% polygon reduction",
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "licence": "CC BY 4.0 (licensor's 2025-02-27 update)",
            "selected": selected,
        },
        "registration": {
            "sourceSkinHeightMm": SOURCE_SKIN_HEIGHT_MM,
            "sourceSkinFloorMm": SOURCE_SKIN_FLOOR_MM,
            "zShiftCm": Z_SHIFT_CM,
            "anteriorHingeCm": ANTERIOR_HINGE_CM,
            "anteriorScale": ANTERIOR_SCALE,
            "armXStartCm": 18,
            "armXFactor": ARM_X_FACTOR,
            "armLandmarks": ARM_LANDMARKS,
        },
    }
    json_bytes = json.dumps(metadata, separators=(",", ":"), ensure_ascii=True).encode()
    head = b"ANAT" + struct.pack("<I", len(json_bytes)) + json_bytes
    head += b"\0" * (-len(head) % 4)
    raw = head + positions + face_bytes
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    report = {
        "file": "public/figure/anatomy-v1.bin", "selectedMeshes": len(selected),
        "sourceVertices": source_vertices, "sourceTriangles": source_triangles,
        "vertices": len(vertices), "triangles": len(indices)//3,
        "groups": groups, "rawBytes": len(raw), "gzipBytes": OUTPUT.stat().st_size,
        "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        "sourceArchiveSha256": SOURCE_SHA256,
        "registration": metadata["registration"],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
