"""
Mayor building kit: a tiny low-poly modelling library for Blender (run headless with `blender -b --python ...`).

Conventions (match the game):
  * One tile = 1 unit. Keep every model inside |x|, |y| <= 0.5; the base sits at z = 0.
  * Blender is Z-up; the front of a building faces -Y (the glTF exporter turns that into +Z in three.js).
  * Materials are named; any material whose name starts with "glow" is emissive and the game turns its
    intensity up at night.

Portions of the facade, roof and palette recipes below are adapted from Fable Cities (MIT,
(c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10); each ported function carries its own
header comment. See docs/process/09-fable-buildings-port.md sections 0, 2.3B, 3.1 and 6 R1.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

# Fable metres -> kit tiles for facade details (report 09 section 0: KIT = 0.6 * m/8).
# Plan quantities use m/8; heights use KIT_STOREY floors. Only small facade/roof trim uses this factor.
_KIT = 0.6 / 8.0


# Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
# buildings/facadeShader.js#bayLayout. Metres converted with KIT (sideM 0.55 m -> 0.041).
def bay_layout(face_w, bay_w, side_m=0.041):
    """Facade bay layout; mirrors the fable GLSL so geometry lands on real bays.

    Returns {"sideM", "usable", "nB", "bay", "x0"} with x0 the local x of the first bay's left edge.
    """
    usable = max(face_w - 2 * side_m, 0.0375)
    nB = max(1, math.floor(usable / max(bay_w, 0.09) + 0.35))
    return {"sideM": side_m, "usable": usable, "nB": nB, "bay": usable / nB, "x0": -face_w / 2 + side_m}


# Glow family per facade style. The suffix selects the V1 night-light litBias; plain "glow_window"
# keeps the 0.6 default. House shares the res family (fable: house 0.70, apartment 0.60).
GLOW_FAMILY = {
    "house": "glow_window_res",
    "apartment": "glow_window_res",
    "retail": "glow_window_shop",
    "curtain": "glow_window_office",
    "industrial": "glow_window_ind",
}
# Fable litBias per generator (facadeShader.js night block; V1 CPU-mirror contract).
LIT_BIAS = {"glow_window": 0.6, "glow_window_res": 0.6, "glow_window_shop": 0.75,
            "glow_window_office": 0.55, "glow_window_ind": 0.35}

# Per-style window boxes from fable FACADE styles (report 09 section 3.1), kit-scaled:
# bay_w (default bay width), win_frac (window width / bay), win_h (absolute, house only),
# win_h_frac / win_c (window height / storey, centre / storey), sill, plinth (band height).
FACADE_STYLES = {
    "house": {"bay_w": 0.18, "win_frac": 0.62, "win_cap": 0.139, "win_h": 0.116, "win_c": 0.55,
              "sill": True, "plinth": 0.0255},
    "apartment": {"bay_w": 0.24, "win_frac": 0.50, "win_h_frac": 0.54, "win_c": 0.56,
                  "tall_frac": 0.28, "tall_h_frac": 0.76, "tall_c": 0.49,
                  "sill": True, "plinth": 0.0638},
    "retail": {"bay_w": 0.28, "win_frac": 0.88, "win_h_frac": 0.60, "win_c": 0.40,
               "sill": False, "plinth": 0.0225},
    "curtain": {"bay_w": 0.14, "mullion": 0.018, "win_h_red": 0.0195, "win_c": 0.50,
                "sill": False, "plinth": 0.0675},
    "industrial": {"bay_w": 0.32, "win_frac": 0.50, "win_h_frac": 0.40, "win_c": 0.62,
                   "sill": False, "plinth": 0.0},
}
# Top margin below the eave/parapet: flat roof 0.45 m, pitched 0.10 m (report 09 section 2.3 B1).
TOP_MARGIN = {"flat": 0.0338, "pitched": 0.0075}

# name -> (base colour hex, roughness, emission hex or None, emission strength)
# Wall tints adapted from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities
# @ aea8b10): buildings/generators.js tint tables (linear) converted to sRGB. Fable's lit facades
# sit at Y ~ 0.18, hue 30-55, S 0.2-0.4; the old kit whites were far brighter and the primaries
# far more saturated (report 09 section 2.3 B8).
PALETTE = {
    "white": ("#cecbc4", 0.8, None, 0),          # FASCIA_TINTS[0]
    "wall_cream": ("#ccbfae", 0.88, None, 0),    # PLASTER_TINTS[0]
    "wall_beige": ("#bfb1a2", 0.88, None, 0),    # PLASTER_TINTS[2]
    "wall_white": ("#d7d4ce", 0.88, None, 0),    # PICKET_TINTS[0], never pure white
    "wall_grey": ("#a2a6aa", 0.88, None, 0),     # MODERN_TINTS[3]
    "wall_brick": ("#b5654a", 0.88, None, 0),
    "wall_wood": ("#9e897e", 0.88, None, 0),     # SIDING_TINTS[6] stained timber
    "wall_blue": ("#adb8bb", 0.88, None, 0),     # SIDING_TINTS[2] slate blue
    "wall_red": ("#ad6961", 0.88, None, 0),      # DOOR_TINTS[3] barn red
    "wall_green": ("#9ea9a6", 0.88, None, 0),    # SIDING_TINTS[3] sage
    "wall_yellow": ("#d4c29e", 0.88, None, 0),   # PLASTER_TINTS[3] ochre
    "wall_navy": ("#869399", 0.88, None, 0),     # SIDING_TINTS[9] dark slate
    "roof_blue": ("#2c4a86", 0.6, None, 0),
    "roof_red": ("#b8402f", 0.7, None, 0),
    "roof_slate": ("#4a5565", 0.65, None, 0),
    "roof_flat": ("#6d747d", 0.9, None, 0),
    "roof_dark": ("#2b303a", 0.8, None, 0),
    "roof_green": ("#3f7a4e", 0.7, None, 0),
    "glass_blue": ("#5b94d0", 0.1, None, 0),
    "glass_dark": ("#3d5a82", 0.1, None, 0),
    "slab": ("#aeb4bb", 0.9, None, 0),
    "hedge": ("#3b8a47", 0.95, None, 0),
    "glow_window": ("#3d5a82", 0.1, "#ffd27a", 1.0),
    # Per-family panes (report 09 section 2.3 B2); the suffix selects the V1 litBias.
    "glow_window_res": ("#3d5a82", 0.1, "#ffd27a", 1.0),
    "glow_window_shop": ("#3d5a82", 0.1, "#ffd27a", 1.0),
    "glow_window_office": ("#3d5a82", 0.1, "#ffd27a", 1.0),
    "glow_window_ind": ("#3d5a82", 0.1, "#ffd27a", 1.0),
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
# Repeat sizes follow fable's TEX_SCALE (generators.js) converted with KIT: brick 1.5-1.7 m
# -> 0.15, plaster 3.0-3.2 m -> 0.22, siding 1.5 m -> 0.11, concrete wall 3.6 m -> 0.27,
# corrugated 2.0 m -> 0.15 (report 09 section 2.3 B7). The old repeats were 2-3x coarse.
PATTERN = {}
for _n in ("white", "wall_cream", "wall_beige", "wall_white", "wall_grey", "wall_blue", "wall_red", "wall_green", "wall_yellow", "wall_navy"):
    PATTERN[_n] = ("plaster", 0.22)
PATTERN.update({
    "wall_brick": ("brick", 0.15), "wall_wood": ("wood", 0.11), "bench_wood": ("wood", 0.2), "bark": ("wood", 0.2), "trunk": ("wood", 0.2),
    "roof_blue": ("roof_tile", 0.3), "roof_red": ("roof_tile", 0.3), "roof_slate": ("roof_tile", 0.3), "roof_green": ("roof_tile", 0.3),
    "roof_flat": ("gravel", 0.35), "roof_dark": ("gravel", 0.35),
    "concrete": ("concrete", 0.27), "slab": ("concrete", 0.27), "paving": ("paving", 0.3), "asphalt": ("asphalt", 0.5),
    "grass": ("grass", 0.25), "hedge": ("leaf", 0.12), "tree_green": ("leaf", 0.12), "tree_dark": ("leaf", 0.12),
    "leaf_a": ("leaf", 0.18), "leaf_b": ("leaf", 0.18), "leaf_c": ("leaf", 0.18), "leaf_pine": ("leaf", 0.18), "leaf_pine_b": ("leaf", 0.18),
    "leaf_pink": ("leaf", 0.18), "leaf_autumn": ("leaf", 0.18), "leaf_dry": ("leaf", 0.18), "palm_frond": ("leaf", 0.18),
    "metal": ("metal", 0.15), "metal_dark": ("metal", 0.15), "lamp_pole": ("metal", 0.15),
    "glass_blue": ("glass_curtain", 0.5), "rock": ("concrete", 0.3),
    "glass_dark": ("window", None), "glow_window": ("window", None),
    "glow_window_res": ("window", None), "glow_window_shop": ("window", None),
    "glow_window_office": ("window", None), "glow_window_ind": ("window", None),
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
        if name.startswith("glow_window") and os.path.exists(os.path.join(TEXTURE_DIR, "window_glow.png")):
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
    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/facadeShader.js FACADE window boxes + sill. Thickness 0.10 m, projection 0.14 m,
    # 0.11 m past the window each side, converted with KIT.
    def sill(self, side, cu, wall, u0, u1, za, off=0.003, mat="white"):
        """A protruding sill under one window: top ledge + front strip. For f/b sides cu is the
        wall centre x and wall is the wall y; for r/l sides cu is the centre y and wall is the wall x."""
        t, proj, ov = 0.10 * _KIT, 0.14 * _KIT, 0.11 * _KIT
        a0, a1 = cu + u0 - ov, cu + u1 + ov
        if side == "f":
            self._quad([(a0, wall - off - proj, za), (a1, wall - off - proj, za), (a1, wall - off, za), (a0, wall - off, za)], mat)
            self._quad([(a0, wall - off - proj, za - t), (a1, wall - off - proj, za - t), (a1, wall - off - proj, za), (a0, wall - off - proj, za)], mat)
        elif side == "b":
            self._quad([(a0, wall + off, za), (a1, wall + off, za), (a1, wall + off + proj, za), (a0, wall + off + proj, za)], mat)
            self._quad([(a1, wall + off + proj, za - t), (a0, wall + off + proj, za - t), (a0, wall + off + proj, za), (a1, wall + off + proj, za)], mat)
        elif side == "r":
            self._quad([(wall + off, a0, za), (wall + off + proj, a0, za), (wall + off + proj, a1, za), (wall + off, a1, za)], mat)
            self._quad([(wall + off + proj, a0, za - t), (wall + off + proj, a1, za - t), (wall + off + proj, a1, za), (wall + off + proj, a0, za)], mat)
        else:
            self._quad([(wall - off - proj, a0, za), (wall - off, a0, za), (wall - off, a1, za), (wall - off - proj, a1, za)], mat)
            self._quad([(wall - off - proj, a1, za - t), (wall - off - proj, a0, za - t), (wall - off - proj, a0, za), (wall - off - proj, a1, za)], mat)

    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/facadeShader.js FACADE plinth bands (house 0.34 m, apartment 0.85 m, retail 0.30 m,
    # curtain 0.9 m, converted with KIT; see FACADE_STYLES).
    def plinth(self, cx, cy, z0, w, d, h, mat="slab"):
        """A masonry band around the base of a mass, slightly proud of the walls."""
        self.box(cx, cy, z0, w + 0.006, d + 0.006, h, mat, roof=mat)

    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/facadeShader.js#bayLayout + FACADE window boxes, sill and plinth (report 09
    # sections 2.3 B1-B3, 3.1). Every pane is a glow_window family pane; the lit/unlit choice moves
    # to the V1 night shader. `lit` stays accepted for old call sites and is ignored.
    def windows(self, cx, cy, z0, w, d, h, floors, cols=None, lit=0.35, sides="fbrl", margin=0.041,
                off=0.003, slabs=True, style="apartment", family=None, bay_w=None, sills=True,
                plinth=True, roof="flat"):
        """Window rows on a box's walls: one glow quad per window with sill, plinth band at the base,
        and a thin slab line per floor. cols=None lays bays out with bay_layout; an explicit cols keeps
        the old window count with the new per-style boxes. style is house/apartment/retail/curtain/
        industrial (FACADE_STYLES); family overrides the GLOW_FAMILY pane material."""
        st = FACADE_STYLES[style]
        mat = family or GLOW_FAMILY[style]
        bw = bay_w or st["bay_w"]
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        fh = h / floors
        top_margin = TOP_MARGIN[roof]
        # The plinth belongs to the whole mass: emit it once, on the call that carries the front.
        # Clamped to 0.22 of the ground storey so short kit floors keep their window clear of it.
        if plinth and st["plinth"] > 0 and z0 < 0.06 and "f" in sides:
            self.plinth(cx, cy, z0, w, d, min(st["plinth"], 0.22 * fh))
        for fl in range(floors):
            zf = z0 + fl * fh
            # Retail upper floors read as apartment boxes (fable RETAIL branch); the ground floor
            # gets the wide shopfront box.
            fst = st if (style != "retail" or fl == 0) else FACADE_STYLES["apartment"]
            if style == "curtain":
                wH, wC = fh - fst["win_h_red"], fst["win_c"]  # width is bay - mullions
            elif "win_h" in fst:
                wH, wC = min(fst["win_h"], 0.8 * fh), fst["win_c"]
            elif "tall_frac" in fst and self.rng.random() < fst["tall_frac"]:
                wH, wC = fst["tall_h_frac"] * fh, fst["tall_c"]
            else:
                wH, wC = fst["win_h_frac"] * fh, fst["win_c"]
            zb = min(zf + wC * fh + wH / 2, zf + fh - (top_margin if fl == floors - 1 else 0.0))
            za = max(zb - wH, zf + 0.02 * fh)
            for side in sides:
                span = (x1 - x0) if side in "fb" else (y1 - y0)
                if cols is None:
                    lay = bay_layout(span, bw, margin)
                    n, bay, bx0 = lay["nB"], lay["bay"], lay["x0"]
                else:
                    n = cols if side in "fb" else max(1, round(span / 0.13))
                    usable = max(span - 2 * margin, 0.0375)
                    n, bay, bx0 = n, usable / n, -span / 2 + margin
                for c in range(n):
                    if style == "curtain":
                        ww = max(bay - 2 * fst["mullion"], 0.03)
                    else:
                        ww = min(bay * fst["win_frac"], fst.get("win_cap", 9.0))
                    u0 = bx0 + (c + 0.5) * bay - ww / 2
                    u1 = bx0 + (c + 0.5) * bay + ww / 2
                    if side == "f":
                        self._quad([(cx + u0, y0 - off, za), (cx + u1, y0 - off, za), (cx + u1, y0 - off, zb), (cx + u0, y0 - off, zb)], mat)
                        if sills and fst["sill"]:
                            self.sill("f", cx, y0, u0, u1, za, off)
                    elif side == "b":
                        self._quad([(cx + u1, y1 + off, za), (cx + u0, y1 + off, za), (cx + u0, y1 + off, zb), (cx + u1, y1 + off, zb)], mat)
                        if sills and fst["sill"]:
                            self.sill("b", cx, y1, u0, u1, za, off)
                    elif side == "r":
                        self._quad([(x1 + off, cy + u0, za), (x1 + off, cy + u1, za), (x1 + off, cy + u1, zb), (x1 + off, cy + u0, zb)], mat)
                        if sills and fst["sill"]:
                            self.sill("r", cy, x1, u0, u1, za, off)
                    else:
                        self._quad([(x0 - off, cy + u1, za), (x0 - off, cy + u0, za), (x0 - off, cy + u0, zb), (x0 - off, cy + u1, zb)], mat)
                        if sills and fst["sill"]:
                            self.sill("l", cy, x0, u0, u1, za, off)
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

    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/generators.js#house front door (architrave slab, leaf, step, canopy, lamp).
    # Architrave 1.36 x 2.42 m over a 1.06 x 2.22 m leaf; step, canopy and lamp converted with KIT.
    def door(self, cx, y_wall, z, w=0.06, h=0.1, mat="wall_wood", frame="white",
             step=False, canopy=False, lamp=False):
        """Front door on a -Y wall: architrave slab + leaf, with optional step, canopy and lamp."""
        self.box(cx, y_wall - 0.004, z, w + 0.022, 0.008, h + 0.015, frame)
        self._quad([(cx - w / 2, y_wall - 0.009, z), (cx + w / 2, y_wall - 0.009, z), (cx + w / 2, y_wall - 0.009, z + h), (cx - w / 2, y_wall - 0.009, z + h)], mat)
        if step:
            self.box(cx, y_wall - 0.032, z, 0.1425, 0.064, 0.012, "concrete", roof="concrete")
        if canopy:
            self.box(cx, y_wall - 0.034, z + h + 0.015, 0.1425, 0.0675, 0.0105, frame, roof=frame)
        if lamp:
            self.box(cx + w / 2 + 0.035, y_wall - 0.004, z + h - 0.035, 0.012, 0.0105, 0.0195, "glow_lamp")

    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/generators.js#house roof trim. Fascia board 0.22 m, gutters 0.13 x 0.14 m on the two
    # eave sides, ridge cap 0.17 x 0.36 m always in the roof's own material; hip roofs keep a shorter
    # ridge (x0.34 / 0.52 / 0.68 by plan ratio). Kit roofs already overhang ~0.03, so w/d are the
    # modelled roof footprint. z_eave is the eave height, ridge_h the ridge rise above it.
    def roof_kit(self, cx, cy, z_eave, w, d, ridge_h, roof_mat, ridge="y", hip=False,
                 fascia=True, gutters=True, cap=True, fascia_mat="white"):
        """Eave fascia, gutters and ridge cap over a pitched roof. Ridge runs along y (default) or x."""
        if fascia:
            self.box(cx, cy, z_eave - 0.0175, w, d, 0.0165, fascia_mat, roof=fascia_mat)
        if gutters:
            gl, gh, gd = 0.0045, 0.0098, 0.0105
            if ridge == "y":  # eaves face +-x
                for s in (-1, 1):
                    self.box(cx + s * (w / 2 + 0.0008), cy, z_eave - 0.027 - gh / 2, gd, d + gl, gh, "slab", roof="slab")
            else:  # eaves face +-y
                for s in (-1, 1):
                    self.box(cx, cy + s * (d / 2 + 0.0008), z_eave - 0.027 - gh / 2, w + gl, gd, gh, "slab", roof="slab")
        if cap:
            shrink = 1.0
            if hip:
                ratio = min(w, d) / max(w, d)
                shrink = 0.34 if ratio > 0.85 else (0.52 if ratio > 0.62 else 0.68)
            zc = z_eave + ridge_h - 0.0045
            if ridge == "y":
                self.box(cx, cy, zc, 0.027, d * shrink, 0.0128, roof_mat, roof=roof_mat)
            else:
                self.box(cx, cy, zc, w * shrink, 0.027, 0.0128, roof_mat, roof=roof_mat)

    # Ported from Fable Cities (MIT, (c) 2026 raw, github.com/rawprogress/fable-cities @ aea8b10):
    # buildings/generators.js#crown. Six archetypes so downtown never repeats one silhouette: flat
    # parapet, stepped setback (x0.74, x0.50), pitched cap, cornice + lantern (0.42w), mast +
    # beacons, glazed lightbox. Kit heights are pinned mid-range; the mast is clamped to 0.45 so the
    # kit skyline stays under the height cap (report 09 section 6 R2). Returns the apex height.
    def crown(self, cx, cy, top, w, d, kind, wall_mat="wall_white", roof_mat="roof_flat"):
        """Tower crown of one of six archetypes. Returns the apex height."""
        if kind == 0:  # flat: parapet ring + coping
            self.box(cx, cy, top - 0.0675, w + 0.0375, d + 0.0375, 0.0788, "slab", roof="slab")
            self.box(cx, cy, top + 0.011, w + 0.0675, d + 0.0675, 0.012, "concrete", roof="concrete")
            return top + 0.023
        if kind == 1:  # stepped setback
            y = top
            for hh, sc in ((0.26, 0.74), (0.22, 0.50)):
                self.box(cx, cy, y - 0.004, w * sc, d * sc, hh, wall_mat, roof=wall_mat)
                self.box(cx, cy, y + hh - 0.0175, w * sc + 0.045, d * sc + 0.045, 0.015, "concrete", roof="concrete")
                y += hh
            return y + 0.015
        if kind == 2:  # pitched / chamfered cap
            hh = min(w, d) * 0.28
            self.box(cx, cy, top - 0.0525, w + 0.03, d + 0.03, 0.0638, "slab", roof="slab")
            self.hip(cx, cy, top + 0.011, w + 0.0375, d + 0.0375, hh, roof_mat)
            zc = top + 0.011 + hh - 0.0045
            if w >= d:  # hip() ridges along the long side
                self.box(cx, cy, zc, (w + 0.0375) * 0.52, 0.027, 0.0128, roof_mat, roof=roof_mat)
            else:
                self.box(cx, cy, zc, 0.027, (d + 0.0375) * 0.52, 0.0128, roof_mat, roof=roof_mat)
            return top + 0.011 + hh
        if kind == 3:  # projecting cornice + lantern
            self.box(cx, cy, top - 0.041, w + 0.1125, d + 0.1125, 0.056, "concrete", roof="concrete")
            self.box(cx, cy, top + 0.015, w + 0.045, d + 0.045, 0.0675, "slab", roof="slab")
            self.box(cx, cy, top + 0.0825, w * 0.42, d * 0.42, 0.30, "glass_blue", roof="glass_blue")
            self.box(cx, cy, top + 0.3825, w * 0.42 + 0.0525, d * 0.42 + 0.0525, 0.0165, "concrete", roof="concrete")
            return top + 0.40
        if kind == 4:  # mast + beacons (mast clamped to 0.45 for the kit skyline)
            self.box(cx, cy, top - 0.0675, w + 0.0375, d + 0.0375, 0.0788, "slab", roof="slab")
            mh = 0.45
            self.cyl(cx, cy, top + 0.015, 0.0165, mh, "metal", seg=6)
            for i in range(3):
                self.cyl(cx, cy, top + 0.02 + (i * 2 + 0.5) * mh / 6, 0.0175, mh / 6 * 0.9, "sign_red", seg=6)
            for f in (0.62, 1.0):
                self.cyl(cx, cy, top + 0.015 + mh * f, 0.011, 0.0165, "metal_dark", seg=6)
                self.box(cx, cy, top + 0.015 + mh * f + 0.015, 0.017, 0.017, 0.0195, "glow_lamp")
            self.cone(cx, cy, top + 0.015 + mh, 0.0165, 0.05, "metal", seg=6)
            return top + 0.065 + mh
        # kind 5: glazed lightbox crown with a lit band
        self.box(cx, cy, top - 0.004, w * 0.9, d * 0.9, 0.32, "glass_blue", roof="glass_blue")
        y0, y1 = cy - d * 0.45 - 0.002, cy + d * 0.45 + 0.002
        self._quad([(cx - w * 0.45 - 0.002, y0, top + 0.10), (cx + w * 0.45 + 0.002, y0, top + 0.10),
                    (cx + w * 0.45 + 0.002, y0, top + 0.22), (cx - w * 0.45 - 0.002, y0, top + 0.22)], "glow_window_office")
        self._quad([(cx + w * 0.45 + 0.002, y1, top + 0.10), (cx - w * 0.45 - 0.002, y1, top + 0.10),
                    (cx - w * 0.45 - 0.002, y1, top + 0.22), (cx + w * 0.45 + 0.002, y1, top + 0.22)], "glow_window_office")
        self.box(cx, cy, top + 0.30, w * 0.9 + 0.0675, d * 0.9 + 0.0675, 0.018, "concrete", roof="concrete")
        return top + 0.34

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
