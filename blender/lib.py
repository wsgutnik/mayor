"""
Mayor building kit: a tiny low-poly modelling library for Blender (run headless with `blender -b --python ...`).

Conventions (match the game):
  * One tile = 1 unit. Keep every model inside |x|, |y| <= 0.5; the base sits at z = 0.
  * Blender is Z-up; the front of a building faces -Y (the glTF exporter turns that into +Z in three.js).
  * Materials are named; any material whose name starts with "glow" is emissive and the game turns its
    intensity up at night.
"""
import math
import os
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
    "glass_dark": ("#3d5a82", 0.2, None, 0),
    "slab": ("#aeb4bb", 0.9, None, 0),
    "hedge": ("#3b8a47", 0.95, None, 0),
    "glow_window": ("#3d5a82", 0.2, "#ffd27a", 1.0),
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
    # foliage and nature
    "leaf_a": ("#4c9a46", 0.9, None, 0),
    "leaf_b": ("#3a8040", 0.9, None, 0),
    "leaf_c": ("#68b251", 0.9, None, 0),
    "leaf_pine": ("#2c6a3f", 0.9, None, 0),
    "leaf_pine_b": ("#24583a", 0.9, None, 0),
    "leaf_pink": ("#f0a3c4", 0.9, None, 0),
    "leaf_autumn": ("#e0802c", 0.9, None, 0),
    "leaf_dry": ("#9aa04a", 0.95, None, 0),
    "palm_frond": ("#3f9a4a", 0.85, None, 0),
    "bark": ("#6e4e34", 0.95, None, 0),
    "rock": ("#8c8a82", 0.95, None, 0),
    "flower_red": ("#d8453a", 0.8, None, 0),
    "flower_yellow": ("#f2c230", 0.8, None, 0),
    # vehicles and props (body is white so the game can tint it per instance)
    "car_body": ("#ffffff", 0.35, None, 0),
    "car_glass": ("#26323f", 0.1, None, 0),
    "tire": ("#17181b", 0.9, None, 0),
    "rim": ("#b9bfc7", 0.4, None, 0),
    "headlight": ("#fff1c0", 0.3, "#fff1c0", 1.0),
    "glow_head": ("#fff1c0", 0.3, "#fff1c0", 1.0),
    "glow_tail": ("#a01818", 0.3, "#ff3030", 1.0),
    "glow_lamp": ("#f5e6b0", 0.3, "#ffd88a", 1.0),
    "lamp_pole": ("#3a3f47", 0.5, None, 0),
    "bench_wood": ("#8a5a34", 0.85, None, 0),
    "hull_white": ("#f2f4f6", 0.5, None, 0),
    "hull_blue": ("#2d5fa8", 0.5, None, 0),
    "sail": ("#f7f3e8", 0.7, None, 0),
}


TEXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "textures")

# palette name -> (texture, world size of one texture repeat). "window" cells map 0..1 per quad.
PATTERN = {}
for _n in ("white", "wall_cream", "wall_beige", "wall_white", "wall_grey", "wall_blue", "wall_red", "wall_green", "wall_yellow", "wall_navy"):
    PATTERN[_n] = ("plaster", 0.5)
PATTERN.update({
    "wall_brick": ("brick", 0.4), "wall_wood": ("wood", 0.35), "bench_wood": ("wood", 0.2), "bark": ("wood", 0.2), "trunk": ("wood", 0.2),
    "roof_blue": ("roof_tile", 0.3), "roof_red": ("roof_tile", 0.3), "roof_slate": ("roof_tile", 0.3), "roof_green": ("roof_tile", 0.3),
    "roof_flat": ("gravel", 0.35), "roof_dark": ("gravel", 0.35),
    "concrete": ("concrete", 0.5), "slab": ("concrete", 0.5), "paving": ("paving", 0.3), "asphalt": ("asphalt", 0.5),
    "grass": ("grass", 0.25), "hedge": ("leaf", 0.12), "tree_green": ("leaf", 0.12), "tree_dark": ("leaf", 0.12),
    "leaf_a": ("leaf", 0.18), "leaf_b": ("leaf", 0.18), "leaf_c": ("leaf", 0.18), "leaf_pine": ("leaf", 0.18), "leaf_pine_b": ("leaf", 0.18),
    "leaf_pink": ("leaf", 0.18), "leaf_autumn": ("leaf", 0.18), "leaf_dry": ("leaf", 0.18), "palm_frond": ("leaf", 0.18),
    "metal": ("metal", 0.3), "metal_dark": ("metal", 0.3), "lamp_pole": ("metal", 0.3),
    "glass_blue": ("glass_curtain", 0.5), "rock": ("concrete", 0.3),
    "glass_dark": ("window", None), "glow_window": ("window", None),
})


def hex_rgba(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)) + (1.0,)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _image(name):
    path = os.path.join(TEXTURE_DIR, name + ".png")
    img = bpy.data.images.get(name + ".png")
    if img is None:
        img = bpy.data.images.load(path)
    return img


def material(name):
    """Create (or reuse) a palette material; patterned ones get a tileable texture multiplied by the tint."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    base, rough, emi, strength = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    r, g, b, _ = hex_rgba(base)
    tint = (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)
    bsdf.inputs["Base Color"].default_value = tint
    bsdf.inputs["Roughness"].default_value = rough
    pat = PATTERN.get(name)
    if pat and os.path.exists(os.path.join(TEXTURE_DIR, pat[0] + ".png")):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = _image(pat[0])
        tex.interpolation = "Linear"
        tex.extension = "REPEAT"
        if pat[0] == "window":
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])      # panes carry their own colour
        else:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            mix.inputs[7].default_value = tint
            links.new(tex.outputs["Color"], mix.inputs[6])
            links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    if emi:
        er, eg, eb, _ = hex_rgba(emi)
        if name == "glow_window" and os.path.exists(os.path.join(TEXTURE_DIR, "window_glow.png")):
            etex = nodes.new("ShaderNodeTexImage")
            etex.image = _image("window_glow")
            links.new(etex.outputs["Color"], bsdf.inputs["Emission Color"])
        else:
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

    def blob(self, cx, cy, cz, rx, ry, rz, mat, subdiv=1, jitter=0.12, seed=0):
        """Low-poly ellipsoid (icosphere) with a little deterministic noise, for canopies and bushes."""
        geom = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        rng = random.Random(seed or int((cx * 977 + cy * 131 + cz * 31) * 1000) & 0xFFFF)
        verts = [v for v in geom["verts"]]
        for v in verts:
            k = 1.0 + rng.uniform(-jitter, jitter)
            v.co = (cx + v.co.x * rx * k, cy + v.co.y * ry * k, cz + v.co.z * rz * k)
        i = self._slot(mat)
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = i

    def wheel(self, cx, cy, cz, r, w, axis="y", mat="tire", rim="rim", seg=8):
        """A short cylinder lying on its side (axis y = along the car's width)."""
        for side in (-1, 1):
            pass
        y0 = cy - w / 2
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            p0 = (cx + math.cos(a0) * r, cz + math.sin(a0) * r)
            p1 = (cx + math.cos(a1) * r, cz + math.sin(a1) * r)
            self._quad([(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p1[0], y0 + w, p1[1]), (p0[0], y0 + w, p0[1])], mat)
            self._tri([(cx, y0, cz), (p1[0], y0, p1[1]), (p0[0], y0, p0[1])], rim)
            self._tri([(cx, y0 + w, cz), (p0[0], y0 + w, p0[1]), (p1[0], y0 + w, p1[1])], rim)

    # -- details ----------------------------------------------------------
    def windows(self, cx, cy, z0, w, d, h, floors, cols=None, lit=0.35, sides="fbrl", margin=0.05, off=0.003, slabs=True):
        """Window rows on a box's walls: one emissive/dark quad per window, plus a thin slab line per floor."""
        cols = cols or max(1, round(w / 0.13))
        lit = max(lit, 0.45)
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        fh = h / floors
        for fl in range(floors):
            za = z0 + fl * fh + fh * 0.2
            zb = z0 + fl * fh + fh * 0.8
            for side in sides:
                n = cols if side in "fb" else max(1, round(d / 0.13))
                span = (x1 - x0) if side in "fb" else (y1 - y0)
                cw = (span - 2 * margin) / n
                for c in range(n):
                    u0 = -span / 2 + margin + c * cw + cw * 0.12
                    u1 = -span / 2 + margin + (c + 1) * cw - cw * 0.12
                    mat = "glow_window" if self.rng.random() < lit else "glass_dark"
                    if side == "f":
                        self._quad([(cx + u0, y0 - off, za), (cx + u1, y0 - off, za), (cx + u1, y0 - off, zb), (cx + u0, y0 - off, zb)], mat)
                    elif side == "b":
                        self._quad([(cx + u1, y1 + off, za), (cx + u0, y1 + off, za), (cx + u0, y1 + off, zb), (cx + u1, y1 + off, zb)], mat)
                    elif side == "r":
                        self._quad([(x1 + off, cy + u0, za), (x1 + off, cy + u1, za), (x1 + off, cy + u1, zb), (x1 + off, cy + u0, zb)], mat)
                    else:
                        self._quad([(x0 - off, cy + u1, za), (x0 - off, cy + u0, za), (x0 - off, cy + u0, zb), (x0 - off, cy + u1, zb)], mat)
            if slabs and fl > 0:
                zs = z0 + fl * fh
                t = 0.012
                if "f" in sides:
                    self._quad([(x0, y0 - 0.006, zs - t / 2), (x1, y0 - 0.006, zs - t / 2), (x1, y0 - 0.006, zs + t / 2), (x0, y0 - 0.006, zs + t / 2)], "slab")
                if "r" in sides:
                    self._quad([(x1 + 0.006, y0, zs - t / 2), (x1 + 0.006, y1, zs - t / 2), (x1 + 0.006, y1, zs + t / 2), (x1 + 0.006, y0, zs + t / 2)], "slab")
                if "l" in sides:
                    self._quad([(x0 - 0.006, y1, zs - t / 2), (x0 - 0.006, y0, zs - t / 2), (x0 - 0.006, y0, zs + t / 2), (x0 - 0.006, y1, zs + t / 2)], "slab")

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
            # low hedges: front verge and the left edge
            self.box(0, -d / 2 + 0.035, 0.03, w * 0.86, 0.03, 0.035, "hedge", roof="hedge")
            self.box(-w / 2 + 0.035, 0.0, 0.03, 0.03, d * 0.7, 0.035, "hedge", roof="hedge")

    # -- dressing helpers used by the detailed models -----------------------
    def balcony(self, cx, y_wall, z, w, depth=0.07, mat="concrete", rail="glass_blue"):
        """A slab sticking out of a front wall at y = y_wall (front faces -Y), with a glass rail."""
        self.box(cx, y_wall - depth / 2, z, w, depth, 0.012, mat, roof=mat)
        self._quad([(cx - w / 2, y_wall - depth, z + 0.012), (cx + w / 2, y_wall - depth, z + 0.012), (cx + w / 2, y_wall - depth, z + 0.055), (cx - w / 2, y_wall - depth, z + 0.055)], rail)
        self._quad([(cx + w / 2, y_wall - depth, z + 0.012), (cx + w / 2, y_wall, z + 0.012), (cx + w / 2, y_wall, z + 0.055), (cx + w / 2, y_wall - depth, z + 0.055)], rail)
        self._quad([(cx - w / 2, y_wall, z + 0.012), (cx - w / 2, y_wall - depth, z + 0.012), (cx - w / 2, y_wall - depth, z + 0.055), (cx - w / 2, y_wall, z + 0.055)], rail)

    def door(self, cx, y_wall, z, w=0.06, h=0.1, mat="wall_wood", frame="white"):
        self.box(cx, y_wall - 0.004, z, w + 0.016, 0.008, h + 0.01, frame)
        self._quad([(cx - w / 2, y_wall - 0.009, z), (cx + w / 2, y_wall - 0.009, z), (cx + w / 2, y_wall - 0.009, z + h), (cx - w / 2, y_wall - 0.009, z + h)], mat)

    def steps(self, cx, y_wall, z, w, n=3, depth=0.04, rise=0.012, mat="concrete"):
        for i in range(n):
            self.box(cx, y_wall - depth * (i + 0.5), z + i * rise, w, depth, rise * (n - i), mat, roof=mat)

    def fence(self, x0, y0, x1, y1, h=0.05, mat="metal_dark", posts=5):
        """A low fence run between two points on the ground (posts and a top rail)."""
        self.box((x0 + x1) / 2, (y0 + y1) / 2, 0.03 + h * 0.8, abs(x1 - x0) + 0.006, abs(y1 - y0) + 0.006, 0.006, mat)
        for i in range(posts):
            t = i / (posts - 1)
            self.box(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.03, 0.007, 0.007, h, mat)

    def ac_unit(self, cx, cy, z, w=0.07, d=0.05, h=0.035):
        self.box(cx, cy, z, w, d, h, "metal", roof="metal_dark")
        self.cyl(cx - w * 0.2, cy, z + h, 0.014, 0.004, "metal_dark", seg=6)

    def parked_car(self, cx, cy, mat="sign_blue", along="x"):
        """A tiny car for lots and car parks (about 30 triangles)."""
        l, w = (0.12, 0.06) if along == "x" else (0.06, 0.12)
        self.box(cx, cy, 0.033, l, w, 0.028, mat, roof=mat)
        cl, cw = (0.062, 0.05) if along == "x" else (0.05, 0.062)
        self.box(cx - (0.008 if along == "x" else 0), cy - (0.008 if along == "y" else 0), 0.061, cl, cw, 0.024, "glass_dark", roof=mat)

    def skylight(self, cx, cy, z, w=0.08, d=0.06):
        self.box(cx, cy, z, w, d, 0.014, "glass_blue", roof="glass_blue")

    def sign(self, cx, y_wall, z, w, h, mat="sign_red"):
        self.box(cx, y_wall - 0.007, z, w, 0.014, h, mat, roof=mat)

    def chimney(self, cx, cy, z, h=0.12, w=0.045, mat="wall_brick"):
        self.box(cx, cy, z, w, w, h, mat)
        self.box(cx, cy, z + h, w + 0.014, w + 0.014, 0.012, "concrete")

    # -- output -----------------------------------------------------------
    def _uv_and_ao(self):
        """Box-projected UVs (windows map 0..1 per quad) and a ground-to-top shading ramp as vertex colour."""
        uv = self.bm.loops.layers.uv.new("UVMap")
        col = self.bm.loops.layers.color.new("Col")
        for f in self.bm.faces:
            name = self.slots[f.material_index] if f.material_index < len(self.slots) else ""
            pat = PATTERN.get(name)
            n = f.normal
            if pat and pat[0] == "window" and len(f.loops) == 4:
                for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                    lp[uv].uv = (u, v)
            else:
                scale = pat[1] if pat and pat[1] else 0.5
                ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
                for lp in f.loops:
                    p = lp.vert.co
                    if az >= ax and az >= ay:
                        lp[uv].uv = (p.x / scale, p.y / scale)
                    elif ax >= ay:
                        lp[uv].uv = (p.y / scale, p.z / scale)
                    else:
                        lp[uv].uv = (p.x / scale, p.z / scale)
            vertical = abs(n.z) < 0.5
            for lp in f.loops:
                z = lp.vert.co.z
                if vertical and not (pat and pat[0] == "window"):
                    t = max(0.0, min(1.0, (z - 0.03) / 0.35))
                    ao = 0.66 + 0.34 * (t * t * (3 - 2 * t))
                elif not vertical and z < 0.06:
                    ao = 0.92   # paving and lawn: faint
                else:
                    ao = 1.0
                lp[col] = (ao, ao, ao, 1.0)

    def build(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.00005)
        self._uv_and_ao()
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
        export_image_format="NONE", export_texcoords=True, export_vertex_color="ACTIVE",
    )


def check_bounds(ob, limit=0.5001, max_h=2.6):
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    xs, ys, zs = [v.x for v in bb], [v.y for v in bb], [v.z for v in bb]
    ok = min(xs) >= -limit and max(xs) <= limit and min(ys) >= -limit and max(ys) <= limit and min(zs) >= -0.001 and max(zs) < max_h
    return ok, (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
