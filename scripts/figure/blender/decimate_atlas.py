"""Repair and decimate BodyParts3D parts for bake-anatomy.py inside Blender.

Run by bake-anatomy.py as
    blender -b --factory-startup --python scripts/figure/blender/decimate_atlas.py -- IN OUT
IN and OUT use the small binary format of lib/atlas_mesh.py. Each part is
cleaned (merged duplicate vertices, loose and degenerate geometry removed,
small holes filled), reduced with Blender's quadric edge-collapse decimation
to its vertex budget, repaired where the collapse pinched it, and given
consistent outward winding.
"""

import sys

import bmesh
import bpy

sys.path.insert(0, __import__("os").path.join(__import__("os").path.dirname(__file__), ".."))
from lib.atlas_mesh import read_parts, write_parts  # noqa: E402

MERGE_CM = 0.002
SPLIT_CM = 0.9


def islands(bm):
    """Face sets connected across edges."""
    seen, out = set(), []
    for face in bm.faces:
        if face in seen:
            continue
        island = [face]
        seen.add(face)
        for f in island:
            for edge in f.edges:
                for g in edge.link_faces:
                    if g not in seen:
                        seen.add(g)
                        island.append(g)
        out.append(island)
    return out


def clean(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=MERGE_CM)
    # Stray fragments a few triangles in size collapse into non-manifold
    # knots under decimation; a part's real shells are far larger.
    shells = sorted(islands(bm), key=len, reverse=True)
    stray = [f for shell in shells[1:] if len(shell) < 0.05 * len(shells[0]) for f in shell]
    if stray:
        bmesh.ops.delete(bm, geom=stray, context="FACES")
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=MERGE_CM)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    # BodyParts3D surfaces are meant to be closed; close the few small gaps.
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=12)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    make_manifold(bm)


def make_manifold(bm):
    """Collapse can pinch thin parts into edges shared by three faces or into
    duplicate faces. Cut those out and close the holes until the part is a
    closed, consistently wound surface again."""
    for _ in range(10):
        seen, duplicates = set(), []
        for face in bm.faces:
            key = frozenset(v.index for v in face.verts)
            if key in seen:
                duplicates.append(face)
            seen.add(key)
        if duplicates:
            bmesh.ops.delete(bm, geom=duplicates, context="FACES_ONLY")
        # Cut one ring around each knot, so the refilled hole is a simple loop.
        knots = {v for e in bm.edges if len(e.link_faces) > 2 for v in e.verts}
        bad = {f for v in knots for f in v.link_faces}
        if bad:
            bmesh.ops.delete(bm, geom=list(bad), context="FACES_ONLY")
        loose = [e for e in bm.edges if not e.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="EDGES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        boundary = [e for e in bm.edges if e.is_boundary]
        if boundary:
            bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
            fan_fill(bm)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.verts.index_update()
        if not duplicates and not bad and not boundary:
            break
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Normal recalculation can guess wrong on a self-touching shell: make each
    # closed shell enclose a positive volume.
    for shell in islands(bm):
        volume = sum(f.verts[0].co.dot(f.verts[1].co.cross(f.verts[2].co)) for f in shell)
        if volume < 0:
            bmesh.ops.reverse_faces(bm, faces=shell)


def fan_fill(bm):
    """Close holes whose outline touches itself (which holes_fill skips) with
    a fan around the outline's centre."""
    bm.edges.index_update()
    # Walk the outlines in index order: a set's own order depends on memory
    # addresses and made the bake differ between runs.
    order = [e for e in bm.edges if e.is_boundary]
    open_edges = set(order)
    for edge in order:
        if edge not in open_edges:
            continue
        open_edges.discard(edge)
        start, current = edge.verts
        loop = [start, current]
        while current is not start:
            step = min((e for e in current.link_edges if e in open_edges), key=lambda e: e.index, default=None)
            if step is None:
                break
            open_edges.discard(step)
            current = step.other_vert(current)
            loop.append(current)
        loop = loop[:-1] if loop[-1] is start else loop
        if len(loop) < 3:
            continue
        centre = bm.verts.new(sum((v.co for v in loop), loop[0].co * 0) / len(loop))
        for a, b in zip(loop, loop[1:] + loop[:1]):
            if a is not b:
                try:
                    bm.faces.new((a, b, centre))
                except ValueError:
                    pass


def trim(bm, clip):
    """Cut a muscle's long tendons at a joint plane and close the cut."""
    point, normal = clip[:3], clip[3:]
    if not any(normal):
        return
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=point, plane_no=normal, clear_outer=True)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    # Pieces cut off from the belly (separate tendon strands) are dropped.
    pieces = islands(bm)
    if len(pieces) > 1:
        keep = max(pieces, key=lambda faces: sum(f.calc_area() for f in faces))
        drop = [f for piece in pieces if piece is not keep for f in piece]
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")


def split_across(bm, plane):
    """Split the long edges that cross a joint plane. The collapse can leave
    one there, and the bent joint then stretches it into a visible tear."""
    point, normal = plane[:3], plane[3:]
    side = lambda v: sum((v.co[i] - point[i]) * normal[i] for i in range(3))
    bm.edges.index_update()
    long = [e for e in bm.edges if e.calc_length() > SPLIT_CM and side(e.verts[0]) * side(e.verts[1]) < 0]
    if long:
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        make_manifold(bm)


def decimate(vertices, faces, target, clip):
    mesh = bpy.data.meshes.new("part")
    mesh.from_pydata(vertices, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    clean(bm)
    trim(bm, clip[:6])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("part", mesh)
    bpy.context.scene.collection.objects.link(obj)
    for _ in range(4):
        if len(mesh.vertices) <= target:
            break
        modifier = obj.modifiers.new("decimate", "DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = max(0.002, target / len(mesh.vertices))
        modifier.use_collapse_triangulate = True
        depsgraph = bpy.context.evaluated_depsgraph_get()
        reduced = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        obj.modifiers.remove(modifier)
        old = obj.data
        obj.data = reduced
        bpy.data.meshes.remove(old)
        mesh = reduced
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=MERGE_CM)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    make_manifold(bm)
    if any(clip[15:]):
        split_across(bm, clip[12:18])
    if any(clip[9:12]):
        # The thin tendon end goes after decimation, so the rest of the part
        # keeps the same reduction as before.
        trim(bm, clip[6:12])
        bmesh.ops.triangulate(bm, faces=bm.faces)
        make_manifold(bm)
    out_v = [tuple(v.co) for v in bm.verts]
    index = {v: i for i, v in enumerate(bm.verts)}
    out_f = [tuple(index[v] for v in f.verts) for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)
    return out_v, out_f


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    parts = read_parts(args[0])
    out = [(key, *decimate(v, f, target, clip)) for key, v, f, target, clip in parts]
    write_parts(args[1], [(key, v, f, 0) for key, v, f in out])
    print(f"decimated {len(out)} parts: {sum(len(v) for _, v, _ in out)} vertices")


if __name__ == "__main__":
    main()
