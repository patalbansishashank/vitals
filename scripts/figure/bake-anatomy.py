"""Bake selected BodyParts3D 4.0 muscle and bone surfaces into a small figure layer.

Run `python scripts/figure/fetch-anatomy.py` first, then this script. Only the
official IS-A tree 99% reduced OBJ archive is used. The atlas is a single adult
male anatomical reference, so the output is an illustration rather than a
person-specific scan. The 8 groups deliberately limit WebGL draw calls.
Each part is repaired and decimated in headless Blender (blender/decimate_atlas.py).
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import gzip
import hashlib
import json
import math
import re
import os
import shutil
import subprocess
import tempfile
import struct
import zipfile

from lib.atlas_mesh import NO_CLIP, read_parts, write_parts
from lib.atlas_pose import atlas_midline, pose_part, skin_midline, source_joints

HERE = Path(__file__).parent
ARCHIVE = HERE / ".cache" / "isa_BP3D_4.0_obj_99.zip"
OUTPUT = HERE / "../../public/figure/anatomy-v1.bin"
REPORT = HERE / "anatomy-bake-report.json"
SOURCE_URL = "https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip"
SOURCE_SHA256 = "40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e"
SOURCE_SKIN_FLOOR_MM = -78.1112
SOURCE_SKIN_HEIGHT_MM = 1719.4712
REGISTRATION = HERE / ".cache" / "skin-registration.json"
REFERENCE_HEIGHT_CM = 165.9
SCALE = REFERENCE_HEIGHT_CM / SOURCE_SKIN_HEIGHT_MM
Z_SHIFT_CM = -3.0
REGIONS = ("head", "trunk", "arms", "legs")
# The linea alba is kept: the atlas has no rectus abdominis, so it closes the
# front of the belly between the two external obliques.
EXCLUDE_MUSCLE = re.compile(r"tendon|tendinous|ligament|membrane|tract|fascia|aponeurosis|retinaculum", re.I)
# The atlas has only the left half of the pelvic floor; it hung between the
# thighs as torn bits and is hidden in a body anyway.
PELVIC_FLOOR = re.compile(r"\b(?:coccygeus|iliococcygeus|pubococcygeus|puborectalis|anal sphincter)\b", re.I)
# Deep suboccipital muscles lie under the skull and stood up as a ragged crown
# on the neck when the bones are hidden.
SUBOCCIPITAL = re.compile(r"\b(?:rectus capitis posterior|rectus capitis lateralis|obliquus capitis)\b", re.I)
# Muscles of the face and jaw stay on the skull; every other muscle reaching
# above the first cervical vertebra is capped there (see neck_clip).
FACE_MUSCLE = re.compile(r"\b(?:masseter|temporalis)\b", re.I)
NECK_CAP_CM = -0.5
LINEA_ALBA_WIDEN = 1.6
EXTERNAL_HEAD_MUSCLE = re.compile(
    r"\b(?:sternocleidomastoid|masseter|temporalis|"
    r"scalenus)\b", re.I,
)
INTERNAL_HEAD_BONE = re.compile(r"\b(?:hyoid|palatine|inferior nasal concha|vomer|tooth|teeth|molar|premolar|incisor|canine)\b", re.I)


def part_id(name: str) -> int:
    return int(re.search(r"FJ(\d+)", name).group(1))


def excluded_head_reason(name: str, label: str) -> str | None:
    n = part_id(name)
    if re.search(r"\bplatysma\b", label, re.I):
        return "skin-level sheet, too thin to draw at this resolution"
    if SUBOCCIPITAL.search(label):
        return "deep suboccipital muscle under the skull"
    if re.search(r"\bdigastric\b", label, re.I):
        return "thin strap under the jaw; stood up as a horn on the neck without the skull"
    if 1555 <= n <= 1601 and not EXTERNAL_HEAD_MUSCLE.search(label):
        return "internal head or throat muscle"
    if 3152 <= n <= 3395 and INTERNAL_HEAD_BONE.search(label):
        return "internal oral, nasal, or throat bone"
    return None


def select(name: str, label: str) -> str | None:
    n = part_id(name)
    if excluded_head_reason(name, label) or PELVIC_FLOOR.search(label):
        return None
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
            # BodyParts3D: mm, z up, front is -y. Keep the source unwarped;
            # registration is driven by measured source and target joints.
            x *= SCALE
            height = (z - SOURCE_SKIN_FLOOR_MM) * SCALE
            front = -y * SCALE + Z_SHIFT_CM
            vertices.append((x, height, front))
        elif line.startswith(b"f "):
            indices = [int(s.split(b"/")[0]) - 1 for s in line.split()[1:]]
            for i in range(1, len(indices) - 1):
                faces.append((indices[0], indices[i], indices[i + 1]))
    return vertices, faces


def side_checked(vertices, label):
    """BodyParts3D names one flexor pollicis brevis pair with swapped sides; trust the geometry."""
    words = label.split()
    named = 1 if "left" in (w.lower() for w in words) else -1 if "right" in (w.lower() for w in words) else 0
    x = sum(v[0] for v in vertices) / len(vertices)
    if named == 0 or abs(x) < 5 or (x > 0) == (named > 0):
        return label
    swap = {"left": "right", "right": "left", "Left": "Right", "Right": "Left"}
    return " ".join(swap.get(w, w) for w in words)


def thin_end(vertices, point, normal, thick, run, most, keep=False):
    """Move a clip plane (removing the side along `normal`) back to where the
    muscle is at least `thick` cm across in both directions for `run` cm, at
    most `most` cm. Thin tendon ends read as frayed strands at this size. None:
    the part is thin throughout (a strand), unless `keep`."""
    ref = (1.0, 0.0, 0.0) if abs(normal[0]) < 0.9 else (0.0, 0.0, 1.0)
    u = [normal[1] * ref[2] - normal[2] * ref[1], normal[2] * ref[0] - normal[0] * ref[2], normal[0] * ref[1] - normal[1] * ref[0]]
    length = math.sqrt(sum(c * c for c in u))
    u = [c / length for c in u]
    w = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]]
    bins = defaultdict(list)
    for v in vertices:
        d = [v[i] - point[i] for i in range(3)]
        t = sum(d[i] * normal[i] for i in range(3))
        if t <= 0:
            bins[math.floor(-t / 0.5)].append((sum(d[i] * u[i] for i in range(3)), sum(d[i] * w[i] for i in range(3))))
    def across(k):
        q = bins.get(k)
        return min(max(a[j] for a in q) - min(a[j] for a in q) for j in (0, 1)) if q else 0.0
    steps = round(run / 0.5)
    for k in range(max(bins, default=-1) + 1):
        if all(across(k + j) >= thick for j in range(steps)):
            return [point[i] - normal[i] * min(k * 0.5, most) for i in range(3)]
    return [point[i] - normal[i] * most for i in range(3)] if keep else None


def tendon_clip(entry, vertices, source):
    """Forearm and leg muscles end at the wrist or ankle; their long tendons are not drawn."""
    if entry["kind"] != "muscle" or entry["region"] not in ("arms", "legs"):
        return NO_CLIP
    x = sum(v[0] for v in vertices) / len(vertices)
    side = "L" if x > 0 else "R"
    near, far = (f"elbow{side}", f"wrist{side}") if entry["region"] == "arms" else (f"knee{side}", f"ankle{side}")
    a, b = source[near], source[far]
    axis = [b[i] - a[i] for i in range(3)]
    length = length0 = math.sqrt(sum(c * c for c in axis))
    normal = [c / length for c in axis]
    # A muscle reaching well up the forearm or shin belongs to it, even when
    # its long finger or toe tendons pull its centre into the hand or foot.
    reach = max(sum((b[i] - v[i]) * normal[i] for i in range(3)) for v in vertices)
    if reach < 6:
        # Hand and foot muscles end at the knuckles or the ball of the foot:
        # they move with the palm or the foot, so tails into the digits would
        # not follow the fingers and toes.
        digit = "finger" if entry["region"] == "arms" else "toe"
        base = source[f"wrist{side}"] if entry["region"] == "arms" else source[f"foot{side}"]
        knuckles = [sum(source[f"{digit}{d}-1{side}"][i] for d in range(2, 6)) / 4 for i in range(3)]
        axis = [knuckles[i] - base[i] for i in range(3)]
        length = math.sqrt(sum(c * c for c in axis))
        normal = [c / length for c in axis]
        first = [knuckles[i] + normal[i] * 0.5 for i in range(3)]
        # They keep their whole length to the knuckles (trimmed back, they
        # were thin shards); only parts thin throughout are dropped.
        point = thin_end(vertices, first, normal, 0.45, 1.5, 0)
    else:
        first = [b[i] + normal[i] * (1.0 if entry["region"] == "arms" else 0.5) for i in range(3)]
        # Shin tendons fan out over the ankle (one muscle, four tendons), which
        # a thickness test reads as a belly: the shin muscles end 1 cm above
        # the ankle. At most 0.5 cm more goes, so forearm and shin muscles
        # reach the wrist and ankle (cut 10 cm short, the hand and foot floated).
        start = first if entry["region"] == "arms" else [b[i] - normal[i] * 1.0 for i in range(3)]
        point = thin_end(vertices, start, normal, 0.6, 3, 0.5, keep=True)
    if point is None:
        return None
    # The joint cut comes before decimation, the thin end after it; edges
    # across the elbow or knee are split.
    return (*first, *normal, *point, *normal, *a, *[(b[i] - a[i]) / length0 for i in range(3)])


def neck_clip(entry, vertices, source):
    """Cap neck muscles just below the first cervical vertebra (the skull
    base; head muscles rise with the skull when posed). Their ends on the
    skull stood up as a ragged crown and two spikes when the bones are
    hidden; the face and jaw muscles stay on the skull."""
    if entry["kind"] != "muscle" or entry["region"] not in ("head", "trunk") or FACE_MUSCLE.search(entry["name"]):
        return NO_CLIP
    # Head-region neck muscles (sternocleidomastoid, scaleni) follow the skull
    # when posed and rose about 1.4 cm above the rest as two spikes.
    level = source["head"][1] + NECK_CAP_CM - (1.5 if entry["region"] == "head" else 0.0)
    if max(v[1] for v in vertices) <= level:
        return NO_CLIP
    # A narrow tendon to the skull (the sternocleidomastoid's mastoid end)
    # stood above the rest as a spike: trim it back to the muscle, at most 3 cm.
    point = thin_end(vertices, (0.0, level, 0.0), (0.0, 1.0, 0.0), 0.6, 1, 3, keep=True)
    return (0.0, level, 0.0, 0.0, 1.0, 0.0, *point, 0.0, 1.0, 0.0, *NO_CLIP[:6])


def blender_decimate(raw_parts):
    """Repair and decimate every part in one headless Blender run (blender/decimate_atlas.py)."""
    blender = os.environ.get("BLENDER") or shutil.which("blender")
    if not blender:
        raise SystemExit("Blender 5.2 is needed for the atlas bake: put it on PATH or set BLENDER")
    with tempfile.TemporaryDirectory() as tmp:
        source, result = Path(tmp) / "parts.bin", Path(tmp) / "decimated.bin"
        write_parts(source, [(entry["id"], v, f, target, clip) for entry, v, f, target, clip in raw_parts])
        subprocess.run([blender, "-b", "--factory-startup", "--python-exit-code", "1", "--python", str(HERE / "blender" / "decimate_atlas.py"),
                        "--", str(source), str(result)], check=True, stdout=subprocess.DEVNULL)
        out = read_parts(result)
    if [key for key, *_ in out] != [entry["id"] for entry, *_ in raw_parts]:
        raise SystemExit("Blender returned a different part list")
    return [(key, v, f) for key, v, f, *_ in out]


def region_of(vertices, label, name):
    n = part_id(name)
    if 1383 <= n <= 1445:
        return "legs"
    if 1466 <= n <= 1518:
        return "arms"
    if 1555 <= n <= 1601:
        return "head"
    if 1446 <= n <= 1465 or 1520 <= n <= 1554:
        return "trunk"
    lower = label.lower()
    if "finger" in lower or "thumb" in lower or "metacarpal" in lower or any(k in lower for k in ("humerus", "radius", "ulna", "scapula", "clavicle", "capitate", "hamate", "lunate", "pisiform", "scaphoid", "trapezium", "trapezoid", "triquetral")):
        return "arms"
    if "toe" in lower or any(k in lower for k in ("femur", "tibia", "fibula", "patella", "metatarsal", "calcaneus", "talus", "cuneiform", "cuboid", "navicular")):
        return "legs"
    x = sum(v[0] for v in vertices) / len(vertices)
    y = sum(v[1] for v in vertices) / len(vertices)
    if "hip bone" in lower or "sacrum" in lower or "coccyx" in lower:
        return "trunk"
    if y > 136:
        return "head"
    if y < 75:
        return "legs"
    return "trunk"


def main() -> None:
    if not ARCHIVE.exists():
        raise SystemExit("Run python scripts/figure/fetch-anatomy.py first")
    if hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise SystemExit("BodyParts3D source archive checksum mismatch")
    if not REGISTRATION.exists():
        raise SystemExit("Run node scripts/figure/bake.ts to export skin registration first")
    registration = json.loads(REGISTRATION.read_text())
    target_joints = {end: {j["id"]: tuple(j[end]) for j in registration["joints"]} for end in ("hipsLed", "shouldersLed")}
    for end in ("hipsLed", "shouldersLed"):
        target_joints[end].update(skin_midline(registration["skin"][end], registration["skin"]["indices"]))
    trunk_points = []
    parts = defaultdict(list)
    selected = []
    excluded_head = []
    excluded_other = []
    side_fixes = []
    raw_parts = []
    bones = {}
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
                reason = excluded_head_reason(name, label)
                if reason:
                    excluded_head.append({"id": Path(name).stem, "name": label, "reason": reason})
                elif PELVIC_FLOOR.search(label):
                    excluded_other.append({"id": Path(name).stem, "name": label, "reason": "half of the pelvic floor, deep in the pelvis"})
                continue
            vertices, faces = parse_obj(raw)
            if re.search(r"\blinea alba\b", label, re.I):
                # It overlaps the obliques' edges by about a millimetre near the pubis, which the decimated
                # edges no longer cover: widen the band so the belly stays closed.
                vertices = [(x * LINEA_ALBA_WIDEN, y, z) for x, y, z in vertices]
            if not vertices or not faces:
                continue
            checked = side_checked(vertices, label)
            if checked != label:
                side_fixes.append({"id": Path(name).stem, "source": label, "used": checked})
                label = checked
            region = region_of(vertices, label, name)
            if kind == "bone":
                bones[label.lower()] = vertices
            if region == "trunk":
                trunk_points.extend(vertices)
            source_vertices += len(vertices)
            source_triangles += len(faces)
            target = min(len(vertices), max(40, round(2.35 * math.sqrt(len(vertices)))))
            entry = {"id": Path(name).stem, "name": label, "kind": kind, "region": region}
            raw_parts.append([entry, vertices, faces, target, NO_CLIP])

    source = source_joints(bones)
    source.update(atlas_midline(trunk_points))
    thin = []
    for part in raw_parts:
        part[4] = tendon_clip(part[0], part[1], source)
        if part[4] is None:
            thin.append({"id": part[0]["id"], "name": part[0]["name"], "reason": "a thin strand throughout"})
        elif part[4] == NO_CLIP:
            part[4] = neck_clip(part[0], part[1], source)
        elif any(part[4][9:12]):
            # The thin end is cut after decimation: the part that stays keeps
            # the whole vertex budget.
            side = lambda p, v: sum((v[i] - p[i]) * p[3 + i] for i in range(3)) <= 0
            before = sum(side(part[4][:6], v) for v in part[1])
            kept = sum(side(part[4][:6], v) and side(part[4][6:], v) for v in part[1])
            part[3] = min(before, round(part[3] * before / max(kept, 1)))
    raw_parts = [part for part in raw_parts if part[4] is not None]
    for (entry, *_), (_, vertices, faces) in zip(raw_parts, blender_decimate(raw_parts)):
        if not faces:
            continue
        parts[(entry["kind"], entry["region"])].append((vertices, faces, entry))
        selected.append(entry)

    vertices = []
    shoulder_vertices = []
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
                vertices.extend(pose_part(vv, entry["name"], entry["kind"], entry["region"], source, target_joints["hipsLed"]))
                shoulder_vertices.extend(pose_part(vv, entry["name"], entry["kind"], entry["region"], source, target_joints["shouldersLed"]))
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
    frame_deltas = bytearray()
    for axis in range(3):
        for low, high in zip(vertices, shoulder_vertices):
            q = round((high[axis] - low[axis]) * 100)
            if not -32768 <= q <= 32767:
                raise SystemExit("Frame delta outside int16 centimetre scale")
            frame_deltas.extend(struct.pack("<h", q))
    metadata = {
        "format": "vitals-anatomy",
        "version": 1,
        "heightCm": registration["heightCm"],
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
            "method": "joint-cage-v1",
            "joints": registration["joints"],
            "sourceJoints": [{"id": j, "point": list(p)} for j, p in source.items()],
            "frameDeltaStepCm": 0.01,
        },
    }
    json_bytes = json.dumps(metadata, separators=(",", ":"), ensure_ascii=True).encode()
    head = b"ANAT" + struct.pack("<I", len(json_bytes)) + json_bytes
    head += b"\0" * (-len(head) % 4)
    raw = head + positions + face_bytes + frame_deltas
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    report = {
        "file": "public/figure/anatomy-v1.bin", "selectedMeshes": len(selected),
        "sourceVertices": source_vertices, "sourceTriangles": source_triangles,
        "vertices": len(vertices), "triangles": len(indices)//3,
        "groups": groups, "rawBytes": len(raw), "gzipBytes": OUTPUT.stat().st_size,
        "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        "sourceArchiveSha256": SOURCE_SHA256,
        "excludedHeadParts": excluded_head,
        "excludedOtherParts": excluded_other + thin,
        "sideCorrections": side_fixes,
        "registration": metadata["registration"],
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    subprocess.run(["node", str(HERE / "bind-anatomy.ts")], check=True)


if __name__ == "__main__":
    main()
