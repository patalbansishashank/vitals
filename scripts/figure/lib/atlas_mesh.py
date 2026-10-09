"""Binary exchange of atlas part meshes between bake-anatomy.py and Blender.

Little-endian: uint32 part count; per part uint16 key length, UTF-8 key,
uint32 target, three float32 planes (point xyz, normal xyz; zero normal =
none): a cut before decimation, a cut after it, and a joint whose crossing
edges are split,
uint32 vertex count, uint32 face count, float32 xyz, uint32 abc.
"""

NO_CLIP = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0) * 3

import struct


def write_parts(path, parts):
    out = bytearray(struct.pack("<I", len(parts)))
    for key, vertices, faces, target, *clip in parts:
        name = key.encode()
        out += struct.pack("<H", len(name)) + name
        out += struct.pack("<I18fII", target, *(clip[0] if clip else NO_CLIP), len(vertices), len(faces))
        out += struct.pack(f"<{3 * len(vertices)}f", *(c for v in vertices for c in v))
        out += struct.pack(f"<{3 * len(faces)}I", *(i for f in faces for i in f))
    with open(path, "wb") as file:
        file.write(out)


def read_parts(path):
    data = open(path, "rb").read()
    count, = struct.unpack_from("<I", data, 0)
    offset = 4
    parts = []
    for _ in range(count):
        size, = struct.unpack_from("<H", data, offset)
        offset += 2
        key = data[offset:offset + size].decode()
        offset += size
        target, *clip, nv, nf = struct.unpack_from("<I18fII", data, offset)
        offset += 84
        flat = struct.unpack_from(f"<{3 * nv}f", data, offset)
        offset += 12 * nv
        idx = struct.unpack_from(f"<{3 * nf}I", data, offset)
        offset += 12 * nf
        parts.append((key, [flat[i:i + 3] for i in range(0, len(flat), 3)], [idx[i:i + 3] for i in range(0, len(idx), 3)], target, tuple(clip)))
    return parts
