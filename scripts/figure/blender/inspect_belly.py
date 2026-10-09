"""Inspect baked keys and fitted meshes side by side, via MCP or headless Blender.

blender -b --python scripts/figure/blender/inspect_belly.py -- <export.json> <output.png>
Export: FIGURE_INSPECT_OUT=<export.json> vitest run tests/figure/belly-export.test.ts
Creates a separate collection and scene; leaves existing work alone. Units are centimetres.
"""
import bpy
import json
import sys
from mathutils import Vector


def inspect(source, output):
    with open(source) as f:
        data = json.load(f)
    scene = bpy.data.scenes.new("Belly inspection")
    collection = bpy.data.collections.new("Baked keys and fitted skin")
    scene.collection.children.link(collection)
    faces = [data["triangles"][i:i+3] for i in range(0, len(data["triangles"]), 3)]
    material = bpy.data.materials.new("Inspection clay")
    material.diffuse_color = (.56, .35, .21, 1)
    names = ["neutral", "belly", "waist", "macroMinMuscle", "skin", "fat"]
    for column, name in enumerate(names):
        points = data["shapes"][name]
        verts = [(points[i+2], points[i], points[i+1]) for i in range(0, len(points), 3)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        obj.location.x = column * 65
        obj.data.materials.append(material)
        for face in mesh.polygons:
            face.use_smooth = True
        obj.shape_key_add(name="Basis")
        if name == "neutral":
            for key in ["belly", "waist", "weight", "macroMinMuscle"]:
                shape = obj.shape_key_add(name=key)
                shape.value = 0
                q = data["shapes"][key]
                for i, v in enumerate(shape.data):
                    v.co = (q[3*i+2], q[3*i], q[3*i+1])
        text = bpy.data.curves.new(name + " label", "FONT")
        text.body = name
        text.size = 4
        label = bpy.data.objects.new(name + " label", text)
        collection.objects.link(label)
        label.location = (column*65-15, -45, 64)
        label.rotation_euler = (1.5707963, 0, 0)
    cam = bpy.data.objects.new("Inspection camera", bpy.data.cameras.new("Inspection camera"))
    collection.objects.link(cam)
    cam.location = (165, -600, 106)
    cam.rotation_euler = (Vector((165, 0, 106)) - cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 390
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.studiolight_rotate_z = .5
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.background_type = 'WORLD'
    scene.world = bpy.data.worlds.new("Inspection background")
    scene.world.color = (.09, .09, .09)
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.filepath = output
    bpy.ops.render.render(write_still=True, scene=scene.name)
    print(json.dumps({"state": data["state"], "armSpacing": data["armSpacing"], "output": output}))
    return scene


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    inspect(args[0], args[1])
