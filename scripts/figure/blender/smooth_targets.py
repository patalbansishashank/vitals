"""Compare Blender's smoothing tools on morph-target delta fields (headless).

Reads the source mesh and a few targets written by `FIGURE_DIAGNOSE=... node scripts/figure/bake.ts`
(<diagnose>-source.json), builds two objects per target (rest shape, rest + target), runs the same smoothing on both
and takes the difference, so a linear smoother smooths the delta field itself. Writes <out>.json with the smoothed
deltas per method, measured afterwards by scripts/figure/measure-smoothed.ts with the same residual as the bake.

Run: blender -b --factory-startup --python scripts/figure/blender/smooth_targets.py -- <source.json> <out.json>
"""
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
source_path, out_path = argv[0], argv[1]
with open(source_path) as f:
    data = json.load(f)
P = data["positions"]
T = data["triangles"]
n = len(P) // 3
verts = [(P[3 * i], P[3 * i + 1], P[3 * i + 2]) for i in range(n)]
faces = [(T[3 * f], T[3 * f + 1], T[3 * f + 2]) for f in range(len(T) // 3)]


def make_object(name, deltas=None):
    mesh = bpy.data.meshes.new(name)
    if deltas is None:
        mesh.from_pydata(verts, [], faces)
    else:
        mesh.from_pydata([(verts[i][0] + deltas[3 * i], verts[i][1] + deltas[3 * i + 1], verts[i][2] + deltas[3 * i + 2]) for i in range(n)], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def positions(obj):
    out = [0.0] * (3 * n)
    for i, v in enumerate(obj.data.vertices):
        out[3 * i], out[3 * i + 1], out[3 * i + 2] = v.co.x, v.co.y, v.co.z
    return out


def apply_modifier(obj, kind, settings):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("m", kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def smooth_vertices(obj, factor, repeat):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.vertices_smooth(factor=factor, repeat=repeat)
    bpy.ops.object.mode_set(mode="OBJECT")


METHODS = {
    # Edit-mode Smooth Vertices: uniform Laplacian, factor per pass.
    "blender smooth vertices x2": lambda o: smooth_vertices(o, 0.5, 2),
    "blender smooth vertices x6": lambda o: smooth_vertices(o, 0.5, 6),
    # Laplacian Smooth modifier: cotangent weights, volume preserved.
    "blender laplacian smooth (cot) x2": lambda o: apply_modifier(o, "LAPLACIANSMOOTH", {"iterations": 2, "lambda_factor": 0.5, "lambda_border": 0.5, "use_volume_preserve": True, "use_normalized": True}),
    "blender laplacian smooth (cot) x6": lambda o: apply_modifier(o, "LAPLACIANSMOOTH", {"iterations": 6, "lambda_factor": 0.5, "lambda_border": 0.5, "use_volume_preserve": True, "use_normalized": True}),
}

results = {}
for target_id, deltas in data["targets"].items():
    results[target_id] = {}
    for name, run in METHODS.items():
        rest = make_object("rest")
        morphed = make_object("morphed", deltas)
        run(rest)
        run(morphed)
        a, b = positions(rest), positions(morphed)
        results[target_id][name] = [round(b[i] - a[i], 4) for i in range(3 * n)]
        for obj in (rest, morphed):
            mesh = obj.data
            bpy.data.objects.remove(obj)
            bpy.data.meshes.remove(mesh)
    # Corrective Smooth smooths the deformation itself (rest = the original coordinates, the deformed shape = rest + target):
    # the morphed object carries the rest shape as a shape key basis and the target as a second key.
    for repeat, label in ((5, "blender corrective smooth x5"), (20, "blender corrective smooth x20")):
        obj = make_object("cs")
        obj.shape_key_add(name="Basis", from_mix=False)
        key = obj.shape_key_add(name="target", from_mix=False)
        for i in range(n):
            key.data[i].co = (verts[i][0] + deltas[3 * i], verts[i][1] + deltas[3 * i + 1], verts[i][2] + deltas[3 * i + 2])
        key.value = 1.0
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("cs", "CORRECTIVE_SMOOTH")
        mod.factor = 0.5
        mod.iterations = repeat
        mod.smooth_type = "LENGTH_WEIGHTED"
        mod.rest_source = "ORCO"
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated)
        results[target_id][label] = [round(mesh.vertices[i].co[k] - verts[i][k], 4) for i in range(n) for k in range(3)]
        bpy.data.meshes.remove(mesh)
        bpy.data.objects.remove(obj)

with open(out_path, "w") as f:
    json.dump({"blender": bpy.app.version_string, "results": results}, f)
print("wrote", out_path, {k: list(v.keys()) for k, v in results.items()})
