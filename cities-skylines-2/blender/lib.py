"""
Mayor building kit: a tiny low-poly modelling library for Blender (run headless with `blender -b --python ...`).

Conventions (match the game):
  * One tile = 1 unit. Keep every model inside |x|, |y| <= 0.5; the base sits at z = 0.
  * Blender is Z-up; the front of a building faces -Y (the glTF exporter turns that into +Z in three.js).
  * Materials are named; any material whose name starts with "glow" is emissive and the game turns its
    intensity up at night.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

# name -> (base colour hex, roughness, emission hex or None, emission strength)
PALETTE = {
    "white": ("#f1eee6", 0.8, None, 0),
    "wall_cream": ("#eadfc8", 0.85, None, 0),
    "wall_beige": ("#d9c7a3", 0.85, None, 0),
    "wall_white": ("#f3f1ea", 0.8, None, 0),
    "wall_grey": ("#bfc3c8", 0.85, None, 0),
    "wall_brick": ("#b5654a", 0.9, None, 0),
    "wall_wood": ("#a8683a", 0.8, None, 0),
    "wall_blue": ("#3f5f93", 0.7, None, 0),
    "wall_red": ("#c23b32", 0.75, None, 0),
    "wall_green": ("#2f8a55", 0.75, None, 0),
    "wall_yellow": ("#e6b84a", 0.75, None, 0),
    "wall_navy": ("#1f3558", 0.7, None, 0),
    "roof_blue": ("#2c4a86", 0.6, None, 0),
    "roof_red": ("#b8402f", 0.7, None, 0),
    "roof_slate": ("#4a5565", 0.65, None, 0),
    "roof_flat": ("#6d747d", 0.9, None, 0),
    "roof_dark": ("#2b303a", 0.8, None, 0),
    "roof_green": ("#3f7a4e", 0.7, None, 0),
    "glass_blue": ("#5b94d0", 0.15, None, 0),
    "glass_dark": ("#34475f", 0.2, None, 0),
    "glow_window": ("#34475f", 0.2, "#ffd27a", 1.0),
    "glow_sign": ("#f5c04a", 0.4, "#ffc94d", 1.0),
    "concrete": ("#c9ccd0", 0.9, None, 0),
    "asphalt": ("#4b4f56", 0.95, None, 0),
    "paving": ("#d8d2c4", 0.9, None, 0),
    "metal": ("#a9b0b8", 0.4, None, 0),
    "metal_dark": ("#59616b", 0.5, None, 0),
    "grass": ("#6fae5a", 0.95, None, 0),
    "tree_green": ("#3f8a45", 0.9, None, 0),
    "tree_dark": ("#2c6a3a", 0.9, None, 0),
    "trunk": ("#7a5a3a", 0.9, None, 0),
    "water": ("#4aa3d8", 0.1, None, 0),
    "sign_red": ("#d63a3a", 0.6, None, 0),
    "sign_green": ("#2c9a55", 0.6, None, 0),
    "sign_blue": ("#2f6fd0", 0.6, None, 0),
    "sign_orange": ("#ee8a2c", 0.6, None, 0),
    "black": ("#1b1d22", 0.8, None, 0),
}


def hex_rgba(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) + (1.0,)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    """Create (or reuse) a palette material."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    base, rough, emi, strength = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    r, g, b, _ = hex_rgba(base)
    bsdf.inputs["Base Color"].default_value = (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    if emi:
        er, eg, eb, _ = hex_rgba(emi)
        bsdf.inputs["Emission Color"].default_value = (_srgb_to_linear(er), _srgb_to_linear(eg), _srgb_to_linear(eb), 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = hex_rgba(base)
    return m


class Model:
    """Collects boxes, roofs and details into one mesh with per-face materials."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []  # material names, index = material slot
        self.rng = random.Random(hash(name) & 0xFFFF)

    # -- plumbing ---------------------------------------------------------
    def _slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def _add(self, faces, mat):
        i = self._slot(mat)
        for f in faces:
            f.material_index = i

    def _quad(self, pts, mat):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        self._add([f], mat)
        return f

    def _tri(self, pts, mat):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        self._add([f], mat)

    # -- primitives -------------------------------------------------------
    def box(self, cx, cy, z0, w, d, h, wall, roof=None, bottom=False):
        """Axis-aligned box centred at (cx, cy) with its base at z0. Roof face may use another material."""
        x0, x1, y0, y1, z1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, z0 + h
        self._quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], wall)  # front (-y)
        self._quad([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], wall)  # back
        self._quad([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], wall)  # right
        self._quad([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], wall)  # left
        self._quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], roof or wall)  # top
        if bottom:
            self._quad([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], wall)

    def gable(self, cx, cy, z0, w, d, h, mat, end=None, ridge="y"):
        """Gabled roof over a w x d footprint; ridge runs along y (default) or x."""
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        zr = z0 + h
        if ridge == "y":
            self._quad([(x1, y0, z0), (x1, y1, z0), (cx, y1, zr), (cx, y0, zr)], mat)
            self._quad([(x0, y1, z0), (x0, y0, z0), (cx, y0, zr), (cx, y1, zr)], mat)
            self._tri([(x0, y0, z0), (x1, y0, z0), (cx, y0, zr)], end or mat)
            self._tri([(x1, y1, z0), (x0, y1, z0), (cx, y1, zr)], end or mat)
        else:
            self._quad([(x0, y0, z0), (x1, y0, z0), (x1, cy, zr), (x0, cy, zr)], mat)
            self._quad([(x1, y1, z0), (x0, y1, z0), (x0, cy, zr), (x1, cy, zr)], mat)
            self._tri([(x1, y0, z0), (x1, y1, z0), (x1, cy, zr)], end or mat)
            self._tri([(x0, y1, z0), (x0, y0, z0), (x0, cy, zr)], end or mat)

    def hip(self, cx, cy, z0, w, d, h, mat, ridge_frac=0.4):
        """Hipped roof; ridge length is ridge_frac of the long side."""
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        zr = z0 + h
        if w >= d:
            rl = (w - d) * ridge_frac + 0.001
            a, b = (cx - rl / 2, cy), (cx + rl / 2, cy)
        else:
            rl = (d - w) * ridge_frac + 0.001
            a, b = (cx, cy - rl / 2), (cx, cy + rl / 2)
        self._quad([(x0, y0, z0), (x1, y0, z0), (b[0], b[1], zr), (a[0], a[1], zr)], mat)
        self._tri([(x1, y0, z0), (x1, y1, z0), (b[0], b[1], zr)], mat)
        self._quad([(x1, y1, z0), (x0, y1, z0), (a[0], a[1], zr), (b[0], b[1], zr)], mat)
        self._tri([(x0, y1, z0), (x0, y0, z0), (a[0], a[1], zr)], mat)

    def pyramid(self, cx, cy, z0, w, d, h, mat):
        self.hip(cx, cy, z0, w, d, h, mat, ridge_frac=0.0)

    def cyl(self, cx, cy, z0, r, h, mat, seg=8, r_top=None, cap=True):
        rt = r if r_top is None else r_top
        zt = z0 + h
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p = [(cx + math.cos(a0) * r, cy + math.sin(a0) * r, z0), (cx + math.cos(a1) * r, cy + math.sin(a1) * r, z0),
                 (cx + math.cos(a1) * rt, cy + math.sin(a1) * rt, zt), (cx + math.cos(a0) * rt, cy + math.sin(a0) * rt, zt)]
            self._quad(p, mat)
            if cap and rt > 0.002:
                self._tri([(cx, cy, zt), (p[3][0], p[3][1], zt), (p[2][0], p[2][1], zt)], mat)

    def cone(self, cx, cy, z0, r, h, mat, seg=7):
        self.cyl(cx, cy, z0, r, h, mat, seg=seg, r_top=0.0005, cap=False)

    # -- details ----------------------------------------------------------
    def windows(self, cx, cy, z0, w, d, h, floors, cols=None, lit=0.35, sides="fbrl", margin=0.06, off=0.003):
        """Window rows on a box's walls: one emissive/dark quad per window (2 triangles each)."""
        cols = cols or max(1, round(w / 0.16))
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        fh = h / floors
        for fl in range(floors):
            za = z0 + fl * fh + fh * 0.28
            zb = z0 + fl * fh + fh * 0.78
            for side in sides:
                n = cols if side in "fb" else max(1, round(d / 0.16))
                span = (x1 - x0) if side in "fb" else (y1 - y0)
                cw = (span - 2 * margin) / n
                for c in range(n):
                    u0 = -span / 2 + margin + c * cw + cw * 0.18
                    u1 = -span / 2 + margin + (c + 1) * cw - cw * 0.18
                    mat = "glow_window" if self.rng.random() < lit else "glass_dark"
                    if side == "f":
                        self._quad([(cx + u0, y0 - off, za), (cx + u1, y0 - off, za), (cx + u1, y0 - off, zb), (cx + u0, y0 - off, zb)], mat)
                    elif side == "b":
                        self._quad([(cx + u1, y1 + off, za), (cx + u0, y1 + off, za), (cx + u0, y1 + off, zb), (cx + u1, y1 + off, zb)], mat)
                    elif side == "r":
                        self._quad([(x1 + off, cy + u0, za), (x1 + off, cy + u1, za), (x1 + off, cy + u1, zb), (x1 + off, cy + u0, zb)], mat)
                    else:
                        self._quad([(x0 - off, cy + u1, za), (x0 - off, cy + u0, za), (x0 - off, cy + u0, zb), (x0 - off, cy + u1, zb)], mat)

    def glass_band(self, cx, cy, z0, w, d, h, mat="glass_blue", inset=0.004):
        """A skin of glazing on the front and sides of a box, for office towers."""
        x0, x1, y0, y1, z1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, z0 + h
        self._quad([(x0 + 0.02, y0 - inset, z0 + 0.03), (x1 - 0.02, y0 - inset, z0 + 0.03), (x1 - 0.02, y0 - inset, z1 - 0.03), (x0 + 0.02, y0 - inset, z1 - 0.03)], mat)
        self._quad([(x1 + inset, y0 + 0.02, z0 + 0.03), (x1 + inset, y1 - 0.02, z0 + 0.03), (x1 + inset, y1 - 0.02, z1 - 0.03), (x1 + inset, y0 + 0.02, z1 - 0.03)], mat)

    def awning(self, cx, cy_front, z, w, depth=0.1, mat="sign_red"):
        """Sloped awning over a front wall at y = cy_front."""
        x0, x1 = cx - w / 2, cx + w / 2
        self._quad([(x0, cy_front, z), (x1, cy_front, z), (x1, cy_front - depth, z - 0.05), (x0, cy_front - depth, z - 0.05)], mat)

    def tree(self, x, y, s=1.0, dark=False):
        self.cyl(x, y, 0.03, 0.012 * s, 0.07 * s, "trunk", seg=5)
        self.cone(x, y, 0.07 * s + 0.03, 0.075 * s, 0.13 * s, "tree_dark" if dark else "tree_green", seg=6)
        self.cone(x, y, 0.13 * s + 0.03, 0.055 * s, 0.1 * s, "tree_green", seg=6)

    def plot(self, w=0.96, d=0.96, lawn=True):
        """The paved plot every kit building stands on, with a lawn border."""
        self.box(0, 0, 0, w, d, 0.03, "paving", roof="paving")
        if lawn:
            m = 0.07
            self._quad([(-w / 2 + 0.01, -d / 2 + 0.01, 0.031), (w / 2 - 0.01, -d / 2 + 0.01, 0.031), (w / 2 - 0.01, -d / 2 + m, 0.031), (-w / 2 + 0.01, -d / 2 + m, 0.031)], "grass")
            self._quad([(-w / 2 + 0.01, d / 2 - m, 0.031), (w / 2 - 0.01, d / 2 - m, 0.031), (w / 2 - 0.01, d / 2 - 0.01, 0.031), (-w / 2 + 0.01, d / 2 - 0.01, 0.031)], "grass")

    # -- output -----------------------------------------------------------
    def build(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.00005)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for s in self.slots:
            me.materials.append(material(s))
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def triangle_count(ob):
    me = ob.data
    return sum(max(1, len(p.vertices) - 2) for p in me.polygons)


def export_glb(ob, path):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
    )


def check_bounds(ob, limit=0.5001, max_h=2.6):
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    xs, ys, zs = [v.x for v in bb], [v.y for v in bb], [v.z for v in bb]
    ok = min(xs) >= -limit and max(xs) <= limit and min(ys) >= -limit and max(ys) <= limit and min(zs) >= -0.001 and max(zs) < max_h
    return ok, (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
