"""Register BodyParts3D surfaces to the two placed MakeHuman joint cages."""

from __future__ import annotations

import math
import re


def add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def mul(a, k):
    return tuple(x * k for x in a)


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    return mul(a, 1 / n) if n else (0.0, -1.0, 0.0)


def mean(points):
    return tuple(sum(p[i] for p in points) / len(points) for i in range(3))


def end_slice(vertices, axis, high):
    """Centroid of the outer 6% of a bone along its measured long axis."""
    ordered = sorted(vertices, key=lambda p: p[axis], reverse=high)
    return mean(ordered[:max(12, round(len(ordered) * .06))])


def long_ends(vertices, origin):
    """Joint-end centroids along a small bone's principal axis: (near origin, far from origin)."""
    c = mean(vertices)
    axis = unit(sub(vertices[0], c)) if norm(sub(vertices[0], c)) else (0.0, 1.0, 0.0)
    for _ in range(30):
        acc = [0.0, 0.0, 0.0]
        for p in vertices:
            d = sub(p, c)
            k = dot(d, axis)
            acc = [acc[i] + d[i] * k for i in range(3)]
        axis = unit(tuple(acc))
    if dot(sub(c, origin), axis) < 0:
        axis = mul(axis, -1)
    ordered = sorted(vertices, key=lambda p: dot(sub(p, c), axis))
    count = max(6, round(len(ordered) * .06))
    return mean(ordered[:count]), mean(ordered[-count:])


def between(a, b, t):
    return add(mul(a, 1 - t), mul(b, t))


def source_joints(bones):
    """Measure atlas joints from long-bone end sections, in placed centimetres."""
    out = {}
    for side, letter in (("left", "L"), ("right", "R")):
        bone = lambda name: bones[f"{side} {name}"]
        hum = bone("humerus")
        ulna = bone("ulna")
        radius = bone("radius")
        femur = bone("femur")
        tibia = bone("tibia")
        fibula = bone("fibula")
        out[f"shoulder{letter}"] = end_slice(hum, 1, True)
        out[f"elbow{letter}"] = mean((end_slice(hum, 1, False), end_slice(ulna, 1, True), end_slice(radius, 1, True)))
        out[f"wrist{letter}"] = mean((end_slice(ulna, 1, False), end_slice(radius, 1, False)))
        out[f"hip{letter}"] = end_slice(femur, 1, True)
        out[f"knee{letter}"] = mean((end_slice(femur, 1, False), end_slice(tibia, 1, True), end_slice(fibula, 1, True)))
        out[f"ankle{letter}"] = mean((end_slice(tibia, 1, False), end_slice(fibula, 1, False)))
        # MakeHuman's foot bone ends where the metatarsals begin.
        out[f"foot{letter}"] = mean([long_ends(bone(f"{ordinal} metatarsal bone"), out[f"ankle{letter}"])[0]
                                     for ordinal in ("first", "second", "third", "fourth", "fifth")])
        wrist = out[f"wrist{letter}"]
        thumb = (bone("first metacarpal bone"), bones[f"proximal phalanx of {side} thumb"], bones[f"distal phalanx of {side} thumb"])
        fingers = [thumb] + [tuple(bones[f"{section} phalanx of {side} {name}"] for section in ("proximal", "middle", "distal"))
                             for name in ("index finger", "middle finger", "ring finger", "little finger")]
        for digit, chain in enumerate(fingers, 1):
            # MakeHuman's thumb starts at its metacarpal; the other fingers start at the knuckle.
            for i, part in enumerate(chain, 1):
                out[f"finger{digit}-{i}{letter}"] = long_ends(part, wrist)[0]
            out[f"finger{digit}-tip{letter}"] = long_ends(chain[-1], wrist)[1]
        ankle = out[f"ankle{letter}"]
        for digit, name in enumerate(("big toe", "second toe", "third toe", "fourth toe", "little toe"), 1):
            sections = ("proximal", "distal") if digit == 1 else ("proximal", "middle", "distal")
            chain = [bones[f"{section} phalanx of {side} {name}"] for section in sections]
            for i, part in enumerate(chain, 1):
                out[f"toe{digit}-{i}{letter}"] = long_ends(part, ankle)[0]
            out[f"toe{digit}-tip{letter}"] = long_ends(chain[-1], ankle)[1]
    out["pelvis"] = mean((mean(bones["left hip bone"]), mean(bones["right hip bone"])))
    out["neck"] = mean(bones["seventh cervical vertebra"])
    # The skin rig's head joint is the skull's pivot on the spine. Its atlas
    # counterpart is the first cervical vertebra, not the jaw in front of it.
    out["head"] = mean(bones["atlas"])
    skull = bones["frontal bone"] + bones["left parietal bone"] + bones["right parietal bone"]
    out["crown"] = end_slice(skull, 1, True)
    return out


TRUNK_HEIGHTS = tuple(range(84, 145, 6))


def midline_centres(depths):
    """Trunk cage joints: the middle of each midline section's front and back."""
    out = {}
    for y in TRUNK_HEIGHTS:
        values = depths.get(y)
        if values:
            out[f"trunk{y}"] = (0.0, float(y), (min(values) + max(values)) / 2)
    return out


def atlas_midline(points):
    """Front-most and back-most atlas tissue near the midline at each cage height.

    Selected tissue leaves gaps (no throat in front of the lower neck), so the
    centres are smoothed along the spine; a kink would fold the upper back."""
    depths = {}
    for x, y, z in points:
        if abs(x) > 2:
            continue
        for h in TRUNK_HEIGHTS:
            if abs(y - h) <= 1:
                depths.setdefault(h, []).append(z)
    raw = midline_centres(depths)
    ids = [f"trunk{h}" for h in TRUNK_HEIGHTS if f"trunk{h}" in raw]
    out = dict(raw)
    for _ in range(2):
        z = [out[i][2] for i in ids]
        for k, i in enumerate(ids):
            near = z[max(0, k - 1):k + 2]
            out[i] = (0.0, out[i][1], sum(near) / len(near))
    return out


def skin_midline(positions, indices):
    """The binder's trunk cage: first skin hits of front and back rays along x = 0."""
    depths = {}
    point = lambda i: positions[3 * i:3 * i + 3]
    for f in range(0, len(indices), 3):
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = (point(indices[f + k]) for k in range(3))
        # Barycentric solve of the triangle's (x, y) projection at x = 0, y = h.
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-12:
            continue
        for h in TRUNK_HEIGHTS:
            u = ((0 - ax) * (cy - ay) - (cx - ax) * (h - ay)) / det
            v = ((bx - ax) * (h - ay) - (0 - ax) * (by - ay)) / det
            if u >= 0 and v >= 0 and u + v <= 1:
                depths.setdefault(h, []).append(az + u * (bz - az) + v * (cz - az))
    return midline_centres(depths)


def rotation(a, b, v):
    """Minimum rotation carrying a to b, with a stable antiparallel fallback."""
    a, b = unit(a), unit(b)
    c = max(-1.0, min(1.0, dot(a, b)))
    cross = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
    s = norm(cross)
    if s < 1e-8:
        if c > 0:
            return v
        axis = unit((0, -a[2], a[1]) if abs(a[0]) > .8 else (-a[1], a[0], 0))
        return sub(mul(axis, 2 * dot(axis, v)), v)
    k = mul(cross, 1 / s)
    kv = (k[1]*v[2]-k[2]*v[1], k[2]*v[0]-k[0]*v[2], k[0]*v[1]-k[1]*v[0])
    return add(add(mul(v, c), mul(kv, s)), mul(k, dot(k, v) * (1 - c)))


def segment_pose(p, a, b, ta, tb):
    axis = sub(b, a)
    length = norm(axis)
    along = dot(sub(p, a), unit(axis))
    radial = sub(sub(p, a), mul(unit(axis), along))
    # A segment shorter than a few millimetres has no reliable length ratio.
    stretch = norm(sub(tb, ta)) / length if length > .3 else 1.0
    return add(add(ta, mul(unit(sub(tb, ta)), along * stretch)), rotation(axis, sub(tb, ta), radial))


def closest_segment(p, chain, source):
    choices = []
    for a, b in zip(chain, chain[1:]):
        ab = sub(source[b], source[a])
        t = max(0, min(1, dot(sub(p, source[a]), ab) / max(dot(ab, ab), 1e-6)))
        q = between(source[a], source[b], t)
        choices.append((norm(sub(p, q)), a, b, t))
    return min(choices)


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x*x*(3 - 2*x)


def pose_chain(p, chain, source, target):
    _, a, b, t = closest_segment(p, chain, source)
    posed = segment_pose(p, source[a], source[b], target[a], target[b])
    # Two segment transforms agree at their shared joint; blend their nearby
    # transverse offsets so muscles do not crease at elbows and knees.
    index = chain.index(a)
    blend_width = .13
    if t < blend_width and index > 0:
        prev = segment_pose(p, source[chain[index-1]], source[a], target[chain[index-1]], target[a])
        posed = between(prev, posed, smoothstep(.5 + t / (2 * blend_width)))
    elif t > 1 - blend_width and index + 2 < len(chain):
        nxt = segment_pose(p, source[b], source[chain[index+2]], target[b], target[chain[index+2]])
        posed = between(posed, nxt, smoothstep((t - (1 - blend_width)) / (2 * blend_width)))
    return posed


def part_chain(label, region, side, source, target):
    side = side or ("L" if "left" in label.lower() else "R" if "right" in label.lower() else None)
    if region == "head":
        return ["neck", "head", "crown"]
    trunk = [f"trunk{y}" for y in TRUNK_HEIGHTS]
    if region == "trunk" or side is None:
        return trunk
    lower = label.lower()
    if region == "arms":
        if "scapula" in lower:
            # The shoulder blade rides on the thorax, not on the arm.
            return trunk
        if any(name in lower for name in ("capitate", "hamate", "lunate", "pisiform", "scaphoid", "trapezium", "trapezoid", "triquetral")):
            return [f"wrist{side}", f"palm{side}"]
        match = re.search(r"\b(thumb|index finger|middle finger|ring finger|little finger|first|second|third|fourth|fifth)\b", lower)
        digit = {"thumb":1,"index finger":2,"middle finger":3,"ring finger":4,"little finger":5,
                 "first":1,"second":2,"third":3,"fourth":4,"fifth":5}.get(match.group(1)) if match else None
        if digit and ("phalanx" in lower or "metacarpal" in lower):
            return [f"wrist{side}", *[f"finger{digit}-{i}{side}" for i in (1,2,3)], f"finger{digit}-tip{side}"]
        return [f"shoulder{side}", f"elbow{side}", f"wrist{side}"]
    if region == "legs":
        match = re.search(r"\b(big toe|second toe|third toe|fourth toe|little toe|first|second|third|fourth|fifth)\b", lower)
        digit = {"big toe":1,"second toe":2,"third toe":3,"fourth toe":4,"little toe":5,
                 "first":1,"second":2,"third":3,"fourth":4,"fifth":5}.get(match.group(1)) if match else None
        if digit and ("phalanx" in lower or "metatarsal" in lower):
            return [f"foot{side}", f"toe{digit}-1{side}", f"toe{digit}-2{side}", *([] if digit == 1 else [f"toe{digit}-3{side}"]), f"toe{digit}-tip{side}"]
        return [f"hip{side}", f"knee{side}", f"ankle{side}", f"foot{side}"]
    return ["pelvis", "neck"]


SCAPULAR = re.compile(r"scapula|subscapularis|infraspinatus|supraspinatus|teres minor|teres major")
# Trunk muscles that end on the shoulder blade or collarbone.
GIRDLE_MUSCLE = re.compile(r"trapezius|levator scapulae|rhomboid|pectoralis minor|serratus anterior|subclavius", re.I)
NECK_PART = re.compile(r"vertebra|intervertebral|\brib\b|axis|atlas", re.I)


SKULL_DROP_CM = 1.6


def head_rigid(p, source, target):
    """One similarity transform for the skull: the head joint and crown carry it."""
    a, b, ta, tb = source["head"], source["crown"], target["head"], target["crown"]
    scale = norm(sub(tb, ta)) / norm(sub(b, a))
    # Measured against the skin's mouth line, the upper jaw sat 2.6-2.8 cm
    # above it (about 1 cm is right, the teeth are not drawn): lower the
    # skull rigidly, as far as the scalp over the crown allows.
    return add(add(ta, mul(rotation(sub(b, a), sub(tb, ta), sub(p, a)), scale)), (0.0, -SKULL_DROP_CM, 0.0))


def pose_part(vertices, label, kind, region, source, target):
    side = "L" if "left" in label.lower() else "R" if "right" in label.lower() else None
    if side and region == "arms":
        source = dict(source)
        target = dict(target)
        source[f"palm{side}"] = mean([source[f"finger{digit}-1{side}"] for digit in range(1, 6)])
        target[f"palm{side}"] = mean([target[f"finger{digit}-1{side}"] for digit in range(1, 6)])
    chain = part_chain(label, region, side, source, target)
    if any(j not in source or j not in target for j in chain):
        missing = [j for j in chain if j not in source or j not in target]
        raise ValueError(f"Missing registration joints for {label}: {missing}")
    out = []
    skull = region == "head" and not NECK_PART.search(label)
    trunk = [f"trunk{y}" for y in TRUNK_HEIGHTS]
    # The shoulder girdle rides on the thorax, moved as one piece so that the
    # shoulder socket meets the skin rig's shoulder joint (and the humeral head).
    girdle = (0.0, 0.0, 0.0)
    if region == "arms" and side:
        girdle = sub(target[f"shoulder{side}"], pose_chain(source[f"shoulder{side}"], trunk, source, target))
    lower = label.lower()
    scapular = region == "arms" and SCAPULAR.search(lower)
    # Muscles inside the hand follow the palm as one piece; blending each
    # vertex toward its nearest finger folded thin palm muscles inside out.
    palm = kind == "muscle" and region == "arms" and side and mean(vertices)[1] < source[f"wrist{side}"][1] - 1
    if palm:
        chain = [f"wrist{side}", f"palm{side}"]
    # Trunk muscles that end on the girdle follow its offset toward that end;
    # otherwise the trapezius overhung the moved shoulder as a flat blade.
    girdles = {}
    if kind == "muscle" and region == "trunk" and GIRDLE_MUSCLE.search(lower):
        for s in ("L", "R"):
            girdles[s] = (sub(target[f"shoulder{s}"], pose_chain(source[f"shoulder{s}"], trunk, source, target)),
                          abs(source[f"shoulder{s}"][0]))
    for p in vertices:
        q = pose_chain(p, chain, source, target)
        if girdles:
            offset, width = girdles["L" if p[0] > 0 else "R"]
            q = add(q, mul(offset, smoothstep((abs(p[0]) / max(width, 1e-6) - .15) / .5)))
        if scapular:
            # The shoulder blade and its own muscles ride on the thorax.
            q = add(pose_chain(p, trunk, source, target), girdle)
            out.append(q)
            continue
        if palm:
            out.append(q)
            continue
        if skull:
            # Skull bones move as one piece; head muscles attached to the skull
            # follow it, then blend into the neck below the skull base.
            rigid = head_rigid(p, source, target)
            q = rigid if kind == "bone" else between(q, rigid, smoothstep((p[1] - source["head"][1] + 2) / 4))
        if region == "arms" and side and (kind == "muscle" or "clavicle" in label.lower()):
            wrist_y = source[f"wrist{side}"][1]
            if p[1] < wrist_y + 2:
                rays = [[f"wrist{side}", *[f"finger{digit}-{i}{side}" for i in (1, 2, 3)], f"finger{digit}-tip{side}"] for digit in range(1, 6)]
                ray = min(rays, key=lambda r: closest_segment(p, r, source)[0])
                hand = pose_chain(p, ray, source, target)
                q = between(q, hand, smoothstep((wrist_y + 2 - p[1]) / 4))
            # The deltoid and rotator cuff span trunk and arm. Attach their
            # medial points gradually to the thorax while the arm rotates.
            shoulder = source[f"shoulder{side}"]
            chest = pose_chain(p, trunk, source, target)
            medial = abs(p[0]) / max(abs(shoulder[0]), 1e-6)
            if medial < 1.3 and p[1] > source[f"elbow{side}"][1]:
                # Toward the midline the girdle offset fades: the collarbone and
                # chest muscles end on the sternum.
                chest = add(chest, mul(girdle, smoothstep((medial - .15) / .5)))
                w = smoothstep((medial - .65) / .55)
                q = between(chest, q, w)
        out.append(q)
    return out
