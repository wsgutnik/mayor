"""Convert one source GLB from third_party/mayor-transport-pack/glb/ into a
single low-poly mesh ready to copy into a lib.Model (see props_fleet.py).

Source contract: metres, Z up, front -Y, vertex colours, many small parts.
Game contract: front +X, wheels at z = 0.005, one mesh, <= 6 palette
materials, body in the tintable ``car_body`` material.
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

import lib

SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                       "third_party", "mayor-transport-pack", "glb")

# name keyword -> palette material, first match wins (vehicles)
VEHICLE_RULES = (
    (("headlight", "headlamp"), "glow_head"),
    (("tail_lamp", "tail_light", "taillight", "taillamp", "emergency"), "glow_tail"),
    (("tire", "tyre"), "tire"),
    (("rim", "hub"), "rim"),
    (("glass", "windshield", "window", "glazing", "destination", "display"), "car_glass"),
    (("chassis", "bumper", "grille", "mirror", "handle", "bellows", "underchassis",
      "frame", "turntable"), "tire"),
)
FURNITURE_RULES = (
    (("glass", "glazing"), "glass_blue"),
    (("lamp_head", "lamp_arm"), "glow_lamp"),
    (("screen", "display", "lcd", "map_route", "route_map"), "glow_sign"),
    (("bench", "wood"), "bench_wood"),
    (("shrub", "leaf", "plant"), "leaf_a"),
    (("soil",), "trunk"),
    (("sign", "icon"), "sign_blue"),
    (("pole", "post", "leg", "column", "metal"), "metal_dark"),
    (("paving", "slab", "concrete"), "concrete"),
)


def _palette_for(name, kind):
    rules = VEHICLE_RULES if kind == "vehicle" else FURNITURE_RULES
    low = name.lower()
    for keys, mat in rules:
        if any(k in low for k in keys):
            return mat
    return "car_body" if kind == "vehicle" else "concrete"


def _tris(ob):
    return sum(max(1, len(p.vertices) - 2) for p in ob.data.polygons)


def _drop_tiny(ob):
    """True for interior/detail crumbs that cannot survive the budget anyway."""
    dims = ob.dimensions
    low = ob.name.lower()
    if any(k in low for k in ("interior", "passage_floor", "pixel", "handle",
                              "separator", "step")) and max(dims) < 0.35:
        return True
    return _tris(ob) <= 2 or max(dims) < 0.045


def convert(sources, target_len, budget, kind="vehicle", scale_mode="len"):
    """Import, join, clean, orient, rescale and decimate; returns the object."""
    before = set(bpy.data.objects)
    for src in sources:
        bpy.ops.import_scene.gltf(filepath=os.path.join(SRC_DIR, src + ".glb"))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = []
    for ob in imported:
        if ob.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        # The pack stores Z-up/front -Y data in a glTF file, so the Blender importer (Y-up -> Z-up) lays it on its
        # side. Detach from the importer's parents and undo that rotation to recover the authored axes.
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        ob.matrix_world = Matrix.Rotation(math.radians(-90), 4, "X") @ ob.matrix_world
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.select_set(False)
        if kind == "vehicle" or True:
            if _drop_tiny(ob) and len(imported) > 8:
                continue
        meshes.append(ob)
    if not meshes:
        raise RuntimeError(f"no mesh in {sources}")
    # palette material per part, decided by its semantic part name
    for ob in meshes:
        mat = lib.material(_palette_for(ob.name, kind))
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.material_index = 0
    # join into one mesh
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for o in list(bpy.data.objects):
        if o is not ob and o not in before and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    # weld + drop loose crumbs
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode="OBJECT")
    # orient: source front -Y -> game front +X; centre; ground the wheels
    dims = Vector(ob.dimensions)
    scale = target_len / (dims.z if scale_mode == "height" else max(dims.x, dims.y))
    rot = Matrix.Rotation(math.radians(90), 4, "Z")
    ob.matrix_world = (Matrix.Translation((0, 0, 0)) @ rot @
                       Matrix.Diagonal((scale, scale, scale, 1.0)) @ ob.matrix_world)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bb = [Vector(c) for c in ob.bound_box]
    cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
    cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
    z0 = 0.005 if kind == "vehicle" else 0.0
    ob.matrix_world = Matrix.Translation((-cx, -cy, z0 - min(v.z for v in bb))) @ ob.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # decimate: collapse toward the budget, then planar dissolve
    for _ in range(3):
        cur = _tris(ob)
        if cur <= budget:
            break
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = max(0.05, min(0.95, budget / cur * 0.92))
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = ob.modifiers.new("flat", "DECIMATE")
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(6)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.0004)
    bpy.ops.object.mode_set(mode="OBJECT")
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    ob.name = "fleet_tmp"
    return ob


def into_model(m, ob):
    """Copy the converted mesh into a lib.Model bmesh (which then bakes AO)."""
    import bmesh  # noqa: F401  (Model owns the bmesh; verts are copied loose)

    slot_of = {}
    for slot, mat in enumerate(ob.data.materials):
        if mat:
            slot_of[slot] = m._slot(mat.name)
    verts = [m.bm.verts.new(tuple(v.co)) for v in ob.data.vertices]
    for p in ob.data.polygons:
        try:
            f = m.bm.faces.new([verts[i] for i in p.vertices])
        except ValueError:
            continue
        f.material_index = slot_of.get(p.material_index, m._slot("car_body"))
    bpy.data.objects.remove(ob, do_unlink=True)
